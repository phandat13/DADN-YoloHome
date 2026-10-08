USE smart_home;

-- Quy ước giá trị trạng thái (chữ thường):
--   Account_state : active | locked
--   Home_Member.Status : active | expired
--   Connection_State : online | offline
--   Lock_Unlock_State : locked | unlocked
--   Access_Result : success | failed        Verify_Method : pin | face | remote
--   Excute_State  : pending | success | failed
--   Source_Type   : user | voice | ai | system
--   Notification.Level : info | warning | critical
-- Data_attached của Device_Command có dạng JSON, ví dụ {"state":"ON"}

DELIMITER $$

-- ===== USER =====
DROP TRIGGER IF EXISTS trg_user_bi$$
CREATE TRIGGER trg_user_bi BEFORE INSERT ON `User` FOR EACH ROW
BEGIN
    SET NEW.Email = LOWER(TRIM(NEW.Email));
    IF NOT fn_is_valid_email(NEW.Email) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email không hợp lệ';
    END IF;
    IF NEW.Display_name IS NULL OR TRIM(NEW.Display_name) = '' THEN
        SET NEW.Display_name = NEW.`Name`;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_user_bu$$
CREATE TRIGGER trg_user_bu BEFORE UPDATE ON `User` FOR EACH ROW
BEGIN
    SET NEW.Email = LOWER(TRIM(NEW.Email));
    IF NOT fn_is_valid_email(NEW.Email) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email không hợp lệ';
    END IF;
END$$

-- ===== HOME =====
DROP TRIGGER IF EXISTS trg_home_bi$$
CREATE TRIGGER trg_home_bi BEFORE INSERT ON Home FOR EACH ROW
BEGIN
    IF NEW.Home_Name IS NULL OR TRIM(NEW.Home_Name) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tên nhà không được để trống';
    END IF;
    IF NEW.`State` IS NULL THEN SET NEW.`State` = 'active'; END IF;
END$$

-- Tạo nhà xong thì chủ nhà tự động trở thành thành viên với vai trò Owner
DROP TRIGGER IF EXISTS trg_home_ai$$
CREATE TRIGGER trg_home_ai AFTER INSERT ON Home FOR EACH ROW
BEGIN
    DECLARE v_owner_role INT DEFAULT NULL;
    SELECT Role_ID INTO v_owner_role FROM Role WHERE Role_Name = 'Owner';
    IF v_owner_role IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chưa có Role Owner trong hệ thống';
    END IF;
    INSERT INTO Home_Member (`Status`, User_ID, Home_ID, Role_ID)
    VALUES ('active', NEW.Owner_ID, NEW.Home_ID, v_owner_role);
END$$

-- Mỗi nhà chỉ có một chủ nhà duy nhất, không được chuyển quyền
DROP TRIGGER IF EXISTS trg_home_bu$$
CREATE TRIGGER trg_home_bu BEFORE UPDATE ON Home FOR EACH ROW
BEGIN
    IF NEW.Owner_ID <> OLD.Owner_ID THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không được thay đổi chủ nhà';
    END IF;
END$$

-- Ghi lại thời điểm cập nhật (thuộc tính đa trị Home_Updated_Time)
DROP TRIGGER IF EXISTS trg_home_au$$
CREATE TRIGGER trg_home_au AFTER UPDATE ON Home FOR EACH ROW
BEGIN
    IF NOT (OLD.Home_Name <=> NEW.Home_Name AND OLD.Address <=> NEW.Address
            AND OLD.`State` <=> NEW.`State`) THEN
        INSERT IGNORE INTO Home_Updated_Time (Home_ID, Updated_Time) VALUES (NEW.Home_ID, NOW());
    END IF;
END$$

-- ===== HOME_MEMBER =====
DROP TRIGGER IF EXISTS trg_home_member_bi$$
CREATE TRIGGER trg_home_member_bi BEFORE INSERT ON Home_Member FOR EACH ROW
BEGIN
    DECLARE v_role  VARCHAR(50);
    DECLARE v_owner INT;
    SELECT Role_Name INTO v_role  FROM Role WHERE Role_ID = NEW.Role_ID;
    SELECT Owner_ID  INTO v_owner FROM Home WHERE Home_ID = NEW.Home_ID;
 
    IF v_role = 'Owner' AND NEW.User_ID <> v_owner THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ chủ nhà mới được giữ vai trò Owner';
    END IF;
    IF v_role <> 'Owner' AND NEW.User_ID = v_owner THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chủ nhà phải giữ vai trò Owner';
    END IF;
    IF v_role = 'Owner' THEN
        SET NEW.Expired = NULL;
    END IF;
    IF v_role = 'Guest' AND NEW.Expired IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khách phải có thời hạn truy cập';
    END IF;
    IF NEW.Expired IS NOT NULL AND NEW.Expired <= NOW() AND LOWER(NEW.`Status`) = 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Thời hạn Expired phải ở tương lai';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_home_member_bu$$
CREATE TRIGGER trg_home_member_bu BEFORE UPDATE ON Home_Member FOR EACH ROW
BEGIN
    DECLARE v_role  VARCHAR(50);
    DECLARE v_owner INT;
    SELECT Owner_ID INTO v_owner FROM Home WHERE Home_ID = NEW.Home_ID;
 
    IF NEW.User_ID = v_owner THEN
        IF NEW.Role_ID <> OLD.Role_ID OR LOWER(NEW.`Status`) <> 'active' OR NEW.Expired IS NOT NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không được thay đổi vai trò/trạng thái của chủ nhà';
        END IF;
    ELSE
        SELECT Role_Name INTO v_role FROM Role WHERE Role_ID = NEW.Role_ID;
        IF v_role = 'Owner' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không được cấp vai trò Owner cho thành viên khác';
        END IF;
        IF v_role = 'Guest' AND NEW.Expired IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Khách phải có thời hạn truy cập';
        END IF;
    END IF;
END$$

-- Thành viên hết hạn/bị vô hiệu -> thu hồi PIN và khuôn mặt
DROP TRIGGER IF EXISTS trg_home_member_au$$
CREATE TRIGGER trg_home_member_au AFTER UPDATE ON Home_Member FOR EACH ROW
BEGIN
    IF LOWER(OLD.`Status`) = 'active' AND LOWER(NEW.`Status`) <> 'active' THEN
        CALL sp_revoke_member_access(NEW.User_ID, NEW.Home_ID);
    END IF;
END$$
 
DROP TRIGGER IF EXISTS trg_home_member_bd$$
CREATE TRIGGER trg_home_member_bd BEFORE DELETE ON Home_Member FOR EACH ROW
BEGIN
    DECLARE v_owner INT;
    SELECT Owner_ID INTO v_owner FROM Home WHERE Home_ID = OLD.Home_ID;
    IF OLD.User_ID = v_owner THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không thể xóa chủ nhà khỏi nhà của mình';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_home_member_ad$$
CREATE TRIGGER trg_home_member_ad AFTER DELETE ON Home_Member FOR EACH ROW
BEGIN
    CALL sp_revoke_member_access(OLD.User_ID, OLD.Home_ID);
END$$

-- ===== ACCESS_CREDENTIAL =====
DROP TRIGGER IF EXISTS trg_access_credential_bi$$
CREATE TRIGGER trg_access_credential_bi BEFORE INSERT ON Access_Credential FOR EACH ROW
BEGIN
    DECLARE v_home INT;
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_Name = NEW.Smart_Door_Name;
    IF NOT fn_is_home_member(NEW.User_ID, v_home) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Người dùng không phải thành viên còn hiệu lực của nhà';
    END IF;
    IF NEW.Credential_Value NOT REGEXP '^[0-9a-f]{64}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Credential_Value phải là mã băm SHA-256, không lưu PIN dạng rõ';
    END IF;
    IF NEW.Valid_From IS NOT NULL AND NEW.Valid_To IS NOT NULL AND NEW.Valid_To < NEW.Valid_From THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid_To phải sau Valid_From';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_access_credential_bu$$
CREATE TRIGGER trg_access_credential_bu BEFORE UPDATE ON Access_Credential FOR EACH ROW
BEGIN
    IF NEW.Credential_Value <> OLD.Credential_Value
       AND NEW.Credential_Value NOT REGEXP '^[0-9a-f]{64}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Credential_Value phải là mã băm SHA-256, không lưu PIN dạng rõ';
    END IF;
    IF NEW.Valid_From IS NOT NULL AND NEW.Valid_To IS NOT NULL AND NEW.Valid_To < NEW.Valid_From THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid_To phải sau Valid_From';
    END IF;
END$$

-- ===== ACCESS_ATTEMPT: cảnh báo cho chủ nhà =====
DROP TRIGGER IF EXISTS trg_access_attempt_ai$$
CREATE TRIGGER trg_access_attempt_ai AFTER INSERT ON Access_Attempt FOR EACH ROW
BEGIN
    DECLARE v_owner INT DEFAULT NULL;
    DECLARE v_fails INT DEFAULT 0;
    DECLARE v_title VARCHAR(150);
 
    SELECT h.Owner_ID INTO v_owner
    FROM Smart_Door sd JOIN Home h ON h.Home_ID = sd.Home_ID
    WHERE sd.Smart_Door_Name = NEW.Smart_Door_Name;
 
    IF LOWER(NEW.Access_Result) = 'failed' THEN
        SET v_fails = fn_count_failed_attempts(NEW.Smart_Door_Name, 10);
        SET v_title = IF(NEW.Failure_Reason = 'unknown_face',
                         'Có người không xác định tiếp cận cửa', 'Truy cập cửa thất bại');
        CALL sp_notify(v_owner, v_title, 'door_alert',
            CONCAT('Cửa ', NEW.Smart_Door_Name, ' - phương thức ', COALESCE(NEW.Verify_Method, 'n/a'),
                   ' - lý do: ', COALESCE(NEW.Failure_Reason, 'không rõ'),
                   '. Số lần thất bại trong 10 phút: ', v_fails, '.'),
            IF(v_fails >= 3, 'critical', 'warning'));
    ELSEIF LOWER(NEW.Access_Result) = 'success' THEN
        CALL sp_notify(v_owner, 'Có người truy cập cửa', 'door_access',
            CONCAT('Cửa ', NEW.Smart_Door_Name, ' được mở bằng phương thức ',
                   COALESCE(NEW.Verify_Method, 'n/a'), '.'),
            'info');
    END IF;
END$$

-- ===== FACE_PROFILE / FACE_RECOGNITION_EVENT =====
DROP TRIGGER IF EXISTS trg_face_profile_bi$$
CREATE TRIGGER trg_face_profile_bi BEFORE INSERT ON Face_Profile FOR EACH ROW
BEGIN
    IF NOT fn_is_home_member(NEW.User_ID, NEW.Home_ID) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Người dùng không phải thành viên còn hiệu lực của nhà';
    END IF;
    IF NEW.Valid_From IS NOT NULL AND NEW.Valid_To IS NOT NULL AND NEW.Valid_To < NEW.Valid_From THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid_To phải sau Valid_From';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_face_profile_bu$$
CREATE TRIGGER trg_face_profile_bu BEFORE UPDATE ON Face_Profile FOR EACH ROW
BEGIN
    IF NEW.Valid_From IS NOT NULL AND NEW.Valid_To IS NOT NULL AND NEW.Valid_To < NEW.Valid_From THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid_To phải sau Valid_From';
    END IF;
END$$

-- FaceProfile và sự kiện nhận diện phải cùng một nhà; độ tin cậy trong 0..100
DROP TRIGGER IF EXISTS trg_fre_bi$$
CREATE TRIGGER trg_fre_bi BEFORE INSERT ON Face_Recognition_Event FOR EACH ROW
BEGIN
    DECLARE v_profile_home INT DEFAULT NULL;
    IF NEW.Face_Profile_ID IS NOT NULL THEN
        SELECT Home_ID INTO v_profile_home FROM Face_Profile WHERE Face_Profile_ID = NEW.Face_Profile_ID;
        IF v_profile_home <> NEW.Home_ID THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FaceProfile không thuộc nhà của sự kiện nhận diện';
        END IF;
    END IF;
    IF NEW.Reliability IS NOT NULL AND (NEW.Reliability < 0 OR NEW.Reliability > 100) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reliability phải nằm trong khoảng 0..100';
    END IF;
END$$

-- ===== VOICE_COMMAND =====
DROP TRIGGER IF EXISTS trg_voice_command_ai$$
CREATE TRIGGER trg_voice_command_ai AFTER INSERT ON Voice_Command FOR EACH ROW
BEGIN
    IF LOWER(NEW.Working_State) = 'unsupported' THEN
        CALL sp_notify(NEW.User_ID, 'Lệnh điều khiển không hợp lệ', 'voice_alert',
            CONCAT('Hệ thống không hỗ trợ lệnh: ', COALESCE(NEW.Command_Detail, '')), 'warning');
    END IF;
END$$

-- ===== DEVICE =====
DROP TRIGGER IF EXISTS trg_device_bi$$
CREATE TRIGGER trg_device_bi BEFORE INSERT ON Device FOR EACH ROW
BEGIN
    IF NEW.Connection_State IS NULL THEN 
        SET NEW.Connection_State = 'offline'; 
    END IF;

    -- Tự động gán đúng 1 trong 8 feed chuẩn nếu Feed_Key bị NULL
    IF NEW.Feed_Key IS NULL OR TRIM(NEW.Feed_Key) = '' THEN
        IF UPPER(NEW.Type_Code) LIKE '%LIGHT%' OR UPPER(NEW.Device_Name) LIKE '%ĐÈN%' THEN
            SET NEW.Feed_Key = 'device-light';
        ELSEIF UPPER(NEW.Type_Code) LIKE '%FAN%' OR UPPER(NEW.Device_Name) LIKE '%QUẠT%' THEN
            SET NEW.Feed_Key = 'device-fan';
        ELSEIF UPPER(NEW.Type_Code) LIKE '%DOOR%' OR UPPER(NEW.Device_Name) LIKE '%CỬA%' THEN
            SET NEW.Feed_Key = 'smart-door';
        ELSEIF UPPER(NEW.Type_Code) LIKE '%HUM%' THEN
            SET NEW.Feed_Key = 'sensor-humidity';
        ELSEIF UPPER(NEW.Type_Code) LIKE '%TEMP%' THEN
            SET NEW.Feed_Key = 'sensor-temperature';
        ELSE
            SET NEW.Feed_Key = 'hardware-log';
        END IF;
    END IF;
END$$

-- Thiết bị mới có trạng thái ban đầu
DROP TRIGGER IF EXISTS trg_device_ai$$
CREATE TRIGGER trg_device_ai AFTER INSERT ON Device FOR EACH ROW
BEGIN
    INSERT INTO Device_State (Current_State, Device_ID) VALUES ('unknown', NEW.Device_ID);
END$$

-- Thay đổi kết nối -> ghi System_Event, mất kết nối -> cảnh báo chủ nhà
DROP TRIGGER IF EXISTS trg_device_au$$
CREATE TRIGGER trg_device_au AFTER UPDATE ON Device FOR EACH ROW
BEGIN
    IF NOT (OLD.Connection_State <=> NEW.Connection_State) THEN
        INSERT INTO System_Event (Connection_State, Description)
        VALUES (NEW.Connection_State,
                CONCAT('Thiết bị "', NEW.Device_Name, '" (ID ', NEW.Device_ID, ') chuyển từ ',
                       COALESCE(OLD.Connection_State, 'n/a'), ' sang ', COALESCE(NEW.Connection_State, 'n/a')));
        IF LOWER(NEW.Connection_State) = 'offline' THEN
            CALL sp_notify_home_owner(NEW.Home_ID, 'Thiết bị mất kết nối', 'device_alert',
                CONCAT('Thiết bị "', NEW.Device_Name, '" đã mất kết nối.'), 'warning');
        END IF;
    END IF;
END$$

-- ===== YOLO_CONTROLLER =====
DROP TRIGGER IF EXISTS trg_yolo_au$$
CREATE TRIGGER trg_yolo_au AFTER UPDATE ON Yolo_Controller FOR EACH ROW
BEGIN
    IF NOT (OLD.Connection_State <=> NEW.Connection_State) THEN
        INSERT INTO System_Event (Connection_State, Description)
        VALUES (NEW.Connection_State,
                CONCAT('Bộ điều khiển "', NEW.Controller_Name, '" (ID ', NEW.Controller_ID, ') chuyển sang ',
                       COALESCE(NEW.Connection_State, 'n/a')));
    END IF;
END$$

-- ===== DEVICE_STATE: thông báo khi đổi trạng thái =====
DROP TRIGGER IF EXISTS trg_device_state_au$$
CREATE TRIGGER trg_device_state_au AFTER UPDATE ON Device_State FOR EACH ROW
BEGIN
    DECLARE v_home INT;
    DECLARE v_name VARCHAR(100);
    DECLARE v_recent_count INT DEFAULT 0;

    -- Chỉ xét khi trạng thái thực sự thay đổi khác nhau
    IF LOWER(TRIM(COALESCE(OLD.Current_State, ''))) <> LOWER(TRIM(COALESCE(NEW.Current_State, ''))) THEN
        SELECT Home_ID, Device_Name INTO v_home, v_name 
        FROM Device 
        WHERE Device_ID = NEW.Device_ID;

        IF v_home IS NOT NULL THEN
            -- Kiểm tra xem trong vòng 5 giây vừa qua đã có thông báo nào của thiết bị này chưa
            SELECT COUNT(*) INTO v_recent_count
            FROM Notification
            WHERE User_ID = (SELECT Owner_ID FROM Home WHERE Home_ID = v_home)
              AND Title = 'Thiết bị thay đổi trạng thái'
              AND Content LIKE CONCAT('%"', v_name, '"%')
              AND Created_At >= NOW() - INTERVAL 5 SECOND;

            -- Nếu chưa có thông báo gần đây thì mới tạo
            IF v_recent_count = 0 THEN
                CALL sp_notify_home_owner(
                    v_home, 
                    'Thiết bị thay đổi trạng thái', 
                    'device_state',
                    CONCAT('Thiết bị "', v_name, '" chuyển sang trạng thái: ', UPPER(NEW.Current_State)), 
                    'info'
                );
            END IF;
        END IF;
    END IF;
END$$
-- ===== DEVICE_COMMAND =====
DROP TRIGGER IF EXISTS trg_device_command_bi$$
CREATE TRIGGER trg_device_command_bi BEFORE INSERT ON Device_Command FOR EACH ROW
BEGIN
  -- Khớp bộ giá trị Source_Type in hoa chuẩn
  IF NEW.Source_Type NOT IN ('USER', 'VOICE_COMMAND', 'SCHEDULE', 'SYSTEM') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Lỗi: Source_Type phải thuộc USER, VOICE_COMMAND, SCHEDULE hoặc SYSTEM';
  END IF;

  -- Nếu không chỉ định trạng thái, khởi tạo mặc định là PENDING
  IF NEW.Excute_State IS NULL THEN
    SET NEW.Excute_State = 'PENDING';
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_device_command_bu$$
CREATE TRIGGER trg_device_command_bu BEFORE UPDATE ON Device_Command FOR EACH ROW
BEGIN
  -- Cho phép cập nhật nếu trạng thái hiện tại là PENDING, EXECUTED hoặc đổi sang trạng thái cuối cùng
  IF OLD.Excute_State IN ('SUCCESS', 'FAILED') AND NEW.Excute_State != OLD.Excute_State THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Lỗi: Không thể thay đổi trạng thái của lệnh đã hoàn thành (SUCCESS/FAILED)';
  END IF;
END$$

-- Lệnh thành công -> cập nhật Device_State; thất bại -> báo người yêu cầu
DROP TRIGGER IF EXISTS trg_device_command_ai$$
CREATE TRIGGER trg_device_command_ai AFTER INSERT ON Device_Command FOR EACH ROW
BEGIN
    -- Source_ID là User_ID của người ra lệnh (web hoặc giọng nói); lịch/hệ thống thì báo chủ nhà
    IF LOWER(NEW.Excute_State) = 'failed' THEN
        CALL sp_notify(IF(UPPER(NEW.Source_Type) IN ('USER', 'VOICE_COMMAND'), NEW.Source_ID,
                          (SELECT h.Owner_ID FROM Device d JOIN Home h ON h.Home_ID = d.Home_ID WHERE d.Device_ID = NEW.Device_ID)),
            'Lệnh điều khiển thất bại', 'command_alert',
            CONCAT('Lệnh #', NEW.Command_ID, ' gửi tới thiết bị ID ', NEW.Device_ID, ' thất bại.'), 'warning');
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_device_command_au$$
CREATE TRIGGER trg_device_command_au AFTER UPDATE ON Device_Command FOR EACH ROW
BEGIN
    DECLARE v_state VARCHAR(50) DEFAULT NULL;
    IF LOWER(OLD.Excute_State) = 'pending' AND LOWER(NEW.Excute_State) = 'success' THEN
        SET v_state = JSON_UNQUOTE(JSON_EXTRACT(NEW.Data_attached, '$.state'));
        IF v_state IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM Device_State WHERE Device_ID = NEW.Device_ID) THEN
                UPDATE Device_State SET Current_State = v_state WHERE Device_ID = NEW.Device_ID;
            ELSE
                INSERT INTO Device_State (Current_State, Device_ID) VALUES (v_state, NEW.Device_ID);
            END IF;
        END IF;
    ELSEIF LOWER(OLD.Excute_State) = 'pending' AND LOWER(NEW.Excute_State) = 'failed' THEN
        CALL sp_notify(IF(UPPER(NEW.Source_Type) IN ('USER', 'VOICE_COMMAND'), NEW.Source_ID,
                          (SELECT h.Owner_ID FROM Device d JOIN Home h ON h.Home_ID = d.Home_ID WHERE d.Device_ID = NEW.Device_ID)),
            'Lệnh điều khiển thất bại', 'command_alert',
            CONCAT('Lệnh #', NEW.Command_ID, ' gửi tới thiết bị ID ', NEW.Device_ID, ' thất bại.'), 'warning');
    END IF;
END$$

-- ===== SENSOR_RECORD =====
DROP TRIGGER IF EXISTS trg_sensor_record_bi$$
CREATE TRIGGER trg_sensor_record_bi BEFORE INSERT ON Sensor_Record FOR EACH ROW
BEGIN
  SET NEW.Data_Quality = LOWER(NEW.Data_Quality);
  IF NEW.Data_Quality NOT IN ('good', 'bad', 'uncertain') THEN
    SET NEW.Data_Quality = 'good';
  END IF;
END$$
-- Có dữ liệu cảm biến -> thiết bị đang online
DROP TRIGGER IF EXISTS trg_sensor_record_ai$$
CREATE TRIGGER trg_sensor_record_ai AFTER INSERT ON Sensor_Record FOR EACH ROW
BEGIN
    UPDATE Device
    SET Last_Connection_Time = NOW(), Connection_State = 'online'
    WHERE Device_ID = (SELECT Device_ID FROM Sensor WHERE Sensor_ID = NEW.Sensor_ID);
END$$

DELIMITER ;


