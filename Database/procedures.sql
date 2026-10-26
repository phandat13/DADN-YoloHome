SET NAMES utf8mb4;
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

DROP PROCEDURE IF EXISTS sp_notify$$
CREATE PROCEDURE sp_notify(IN p_user_id INT, IN p_title VARCHAR(150), IN p_type VARCHAR(50),
                           IN p_content TEXT, IN p_level VARCHAR(30))
BEGIN
    IF p_user_id IS NOT NULL THEN
        INSERT INTO Notification (Title, `Type`, Content, `Level`, User_ID)
        VALUES (p_title, p_type, p_content, p_level, p_user_id);
    END IF;
END$$
 
DROP PROCEDURE IF EXISTS sp_notify_home_owner$$
CREATE PROCEDURE sp_notify_home_owner(IN p_home_id INT, IN p_title VARCHAR(150), IN p_type VARCHAR(50),
                                      IN p_content TEXT, IN p_level VARCHAR(30))
BEGIN
    DECLARE v_owner INT DEFAULT NULL;
    SELECT Owner_ID INTO v_owner FROM Home WHERE Home_ID = p_home_id;
    CALL sp_notify(v_owner, p_title, p_type, p_content, p_level);
END$$

DROP PROCEDURE IF EXISTS sp_log_activity$$
CREATE PROCEDURE sp_log_activity(IN p_user_id INT, IN p_home_id INT, IN p_entity_type VARCHAR(50),
                                 IN p_action VARCHAR(100), IN p_source VARCHAR(50), IN p_result VARCHAR(50))
BEGIN
    INSERT INTO Activity_Log (Entity_Type, `Action`, `Source`, `Result`, User_ID, Home_ID)
    VALUES (p_entity_type, p_action, p_source, p_result, p_user_id, p_home_id);
END$$

-- Thu hồi PIN và vô hiệu hóa khuôn mặt của người dùng trong một nhà
DROP PROCEDURE IF EXISTS sp_revoke_member_access$$
CREATE PROCEDURE sp_revoke_member_access(IN p_user_id INT, IN p_home_id INT)
BEGIN
    UPDATE Access_Credential ac
    JOIN Smart_Door sd ON sd.Smart_Door_ID = ac.Smart_Door_ID
    SET ac.Credential_State = 'revoked'
    WHERE ac.User_ID = p_user_id AND sd.Home_ID = p_home_id
      AND LOWER(ac.Credential_State) = 'active';
 
    UPDATE Face_Profile
    SET Valid_To = NOW()
    WHERE User_ID = p_user_id AND Home_ID = p_home_id
      AND (Valid_From IS NULL OR Valid_From <= NOW())
      AND (Valid_To IS NULL OR Valid_To > NOW());
END$$

 
-- ===== Tài khoản (6.1) =====
DROP PROCEDURE IF EXISTS sp_register_user$$
CREATE PROCEDURE sp_register_user(IN p_name VARCHAR(100), IN p_email VARCHAR(150),
                                  IN p_password_hash VARCHAR(255), IN p_display_name VARCHAR(100),
                                  OUT p_user_id INT)
BEGIN
    IF EXISTS (SELECT 1 FROM `User` WHERE Email = LOWER(TRIM(p_email))) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email đã được đăng ký';
    END IF;
    INSERT INTO `User` (`Name`, Email, `Password`, Display_name, Account_state)
    VALUES (p_name, p_email, p_password_hash, p_display_name, 'active');
    SET p_user_id = LAST_INSERT_ID();
END$$
 
-- Chỉ so khớp mã băm do ứng dụng gửi lên. Nếu dùng bcrypt/argon2 thì lấy hash theo email
-- rồi xác thực ở tầng ứng dụng.
DROP PROCEDURE IF EXISTS sp_authenticate_user$$
CREATE PROCEDURE sp_authenticate_user(IN p_email VARCHAR(150), IN p_password_hash VARCHAR(255),
                                      OUT p_user_id INT, OUT p_result VARCHAR(20))
BEGIN
    DECLARE v_id INT DEFAULT NULL;
    DECLARE v_pw VARCHAR(255) DEFAULT NULL;
    DECLARE v_state VARCHAR(30) DEFAULT NULL;
 
    SELECT User_ID, `Password`, Account_state INTO v_id, v_pw, v_state
    FROM `User` WHERE Email = LOWER(TRIM(p_email));
 
    SET p_user_id = NULL;
    IF v_id IS NULL OR v_pw <> p_password_hash THEN
        SET p_result = 'invalid';
    ELSEIF LOWER(v_state) <> 'active' THEN
        SET p_result = 'locked';
    ELSE
        SET p_result = 'success';
        SET p_user_id = v_id;
    END IF;
END$$
 
-- ===== Home (6.2) =====
DROP PROCEDURE IF EXISTS sp_create_home$$
CREATE PROCEDURE sp_create_home(IN p_owner_id INT, IN p_home_name VARCHAR(100),
                                IN p_address VARCHAR(255), OUT p_home_id INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM `User` WHERE User_ID = p_owner_id AND LOWER(Account_state) = 'active') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tài khoản không tồn tại hoặc không hoạt động';
    END IF;
    -- trigger trg_home_ai tự thêm chủ nhà vào Home_Member với vai trò Owner
    INSERT INTO Home (Home_Name, Address, `State`, Owner_ID)
    VALUES (TRIM(p_home_name), p_address, 'active', p_owner_id);
    SET p_home_id = LAST_INSERT_ID();
    CALL sp_log_activity(p_owner_id, p_home_id, 'home', 'create_home', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_update_home$$
CREATE PROCEDURE sp_update_home(IN p_actor_id INT, IN p_home_id INT, IN p_home_name VARCHAR(100),
                                IN p_address VARCHAR(255), IN p_state VARCHAR(30))
BEGIN
    IF NOT fn_has_permission(p_actor_id, p_home_id, 'HOME_UPDATE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền cập nhật nhà';
    END IF;
    UPDATE Home
    SET Home_Name = COALESCE(p_home_name, Home_Name),
        Address   = COALESCE(p_address, Address),
        `State`   = COALESCE(p_state, `State`)
    WHERE Home_ID = p_home_id;
    CALL sp_log_activity(p_actor_id, p_home_id, 'home', 'update_home', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_delete_home$$
CREATE PROCEDURE sp_delete_home(IN p_actor_id INT, IN p_home_id INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Home WHERE Home_ID = p_home_id AND Owner_ID = p_actor_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ chủ nhà mới được xóa nhà';
    END IF;
    DELETE FROM Home WHERE Home_ID = p_home_id;
END$$
 
-- ===== Thành viên (6.3) =====
DROP PROCEDURE IF EXISTS sp_add_member$$
CREATE PROCEDURE sp_add_member(IN p_actor_id INT, IN p_home_id INT, IN p_target_email VARCHAR(150),
                               IN p_role_name VARCHAR(50), IN p_expired DATETIME)
BEGIN
    DECLARE v_target INT DEFAULT NULL;
    DECLARE v_role   INT DEFAULT NULL;
    DECLARE v_home_name VARCHAR(100);
 
    IF NOT fn_has_permission(p_actor_id, p_home_id, 'MEMBER_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý thành viên';
    END IF;
    SELECT User_ID INTO v_target FROM `User`
    WHERE Email = LOWER(TRIM(p_target_email)) AND LOWER(Account_state) = 'active';
    IF v_target IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy tài khoản người dùng';
    END IF;
    SELECT Role_ID INTO v_role FROM Role WHERE Role_Name = p_role_name;
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vai trò không tồn tại';
    END IF;
    IF p_role_name = 'Owner' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không thể gán vai trò Owner';
    END IF;
 
    -- thêm mới, hoặc kích hoạt lại thành viên đã hết hạn / bị vô hiệu
    INSERT INTO Home_Member (`Status`, Expired, User_ID, Home_ID, Role_ID)
    VALUES ('active', p_expired, v_target, p_home_id, v_role)
    ON DUPLICATE KEY UPDATE `Status` = 'active', Expired = p_expired, Role_ID = v_role, Joined = NOW();
 
    SELECT Home_Name INTO v_home_name FROM Home WHERE Home_ID = p_home_id;
    CALL sp_notify(v_target, 'Bạn được thêm vào nhà', 'member',
        CONCAT('Bạn đã được thêm vào nhà "', v_home_name, '" với vai trò ', p_role_name, '.'), 'info');
    CALL sp_log_activity(p_actor_id, p_home_id, 'home_member', 'add_member', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_change_member_role$$
CREATE PROCEDURE sp_change_member_role(IN p_actor_id INT, IN p_home_id INT, IN p_target_user_id INT,
                                       IN p_role_name VARCHAR(50), IN p_expired DATETIME)
BEGIN
    DECLARE v_role INT DEFAULT NULL;
    IF NOT fn_has_permission(p_actor_id, p_home_id, 'MEMBER_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý thành viên';
    END IF;
    SELECT Role_ID INTO v_role FROM Role WHERE Role_Name = p_role_name;
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vai trò không tồn tại';
    END IF;
    UPDATE Home_Member SET Role_ID = v_role, Expired = p_expired
    WHERE User_ID = p_target_user_id AND Home_ID = p_home_id;
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Người dùng không phải thành viên của nhà';
    END IF;
    CALL sp_log_activity(p_actor_id, p_home_id, 'home_member', 'change_role', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_remove_member$$
CREATE PROCEDURE sp_remove_member(IN p_actor_id INT, IN p_home_id INT, IN p_target_user_id INT)
BEGIN
    IF NOT fn_has_permission(p_actor_id, p_home_id, 'MEMBER_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý thành viên';
    END IF;
    DELETE FROM Home_Member WHERE User_ID = p_target_user_id AND Home_ID = p_home_id;
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Người dùng không phải thành viên của nhà';
    END IF;
    CALL sp_log_activity(p_actor_id, p_home_id, 'home_member', 'remove_member', 'web', 'success');
END$$
 
-- Đánh dấu hết hạn cho khách/thành viên có Expired đã qua (gọi định kỳ bằng EVENT)
DROP PROCEDURE IF EXISTS sp_expire_members$$
CREATE PROCEDURE sp_expire_members()
BEGIN
    UPDATE Home_Member SET `Status` = 'expired'
    WHERE LOWER(`Status`) = 'active' AND Expired IS NOT NULL AND Expired <= NOW();
END$$
 
-- ===== Thiết bị (6.5) =====
DROP PROCEDURE IF EXISTS sp_add_device$$
CREATE PROCEDURE sp_add_device(
    IN p_actor_id INT, 
    IN p_home_id INT, 
    IN p_type_code VARCHAR(50),
    IN p_device_name VARCHAR(100), 
    IN p_hardware_id VARCHAR(100),
    IN p_serial_no VARCHAR(100), 
    IN p_controller_id INT, 
    IN p_feed_key VARCHAR(100),        -- Bổ sung tham số Feed_Key
    OUT p_device_id INT
)
BEGIN
    DECLARE v_feed VARCHAR(100);

    IF NOT fn_has_permission(p_actor_id, p_home_id, 'DEVICE_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền thêm thiết bị';
    END IF;

    -- Tự động gán đúng 1 trong 8 feed chuẩn nếu p_feed_key truyền vào bị NULL
    SET v_feed = p_feed_key;
    IF v_feed IS NULL OR TRIM(v_feed) = '' THEN
        IF UPPER(p_type_code) LIKE '%LIGHT%' OR UPPER(p_device_name) LIKE '%ĐÈN%' THEN
            SET v_feed = 'device-light';
        ELSEIF UPPER(p_type_code) LIKE '%FAN%' OR UPPER(p_device_name) LIKE '%QUẠT%' THEN
            SET v_feed = 'device-fan';
        ELSEIF UPPER(p_type_code) LIKE '%DOOR%' OR UPPER(p_device_name) LIKE '%CỬA%' THEN
            SET v_feed = 'smart-door';
        ELSE
            SET v_feed = 'hardware-log';
        END IF;
    END IF;

    INSERT INTO Device (Device_Name, Hardware_ID, Serial_No, Available_working_State,
                        Home_ID, Type_Code, Controller_ID, Feed_Key)
    VALUES (p_device_name, p_hardware_id, p_serial_no, 'off', p_home_id, p_type_code, p_controller_id, v_feed);
    
    SET p_device_id = LAST_INSERT_ID();
    CALL sp_log_activity(p_actor_id, p_home_id, 'device', 'add_device', 'web', 'success');
END$$
 
-- Gửi lệnh điều khiển (từ Web/App, giọng nói, AI...). Thiết bị offline -> lệnh thất bại ngay.
DROP PROCEDURE IF EXISTS sp_send_device_command$$
CREATE PROCEDURE `sp_send_device_command`(
  IN p_device_id INT,
  IN p_actor_id INT,
  IN p_action VARCHAR(50),
  IN p_source_type VARCHAR(50),
  IN p_payload LONGTEXT,
  OUT p_command_id BIGINT
)
BEGIN
  DECLARE v_source_type ENUM('USER', 'VOICE_COMMAND', 'SCHEDULE', 'SYSTEM');
  DECLARE v_conn_state ENUM('online', 'offline');

  -- Kiểm tra thiết bị có đang online không
  SELECT Connection_State INTO v_conn_state
  FROM Device
  WHERE Device_ID = p_device_id;

  IF v_conn_state IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Thiết bị không tồn tại';
  END IF;

  IF UPPER(p_source_type) IN ('VOICE', 'VOICE_COMMAND') THEN
    SET v_source_type = 'VOICE_COMMAND';
  ELSEIF UPPER(p_source_type) = 'SCHEDULE' THEN
    SET v_source_type = 'SCHEDULE';
  ELSEIF UPPER(p_source_type) = 'SYSTEM' THEN
    SET v_source_type = 'SYSTEM';
  ELSE
    SET v_source_type = 'USER';
  END IF;

  INSERT INTO Device_Command (
    Device_ID,
    Source_ID,
    Source_Type,
    Data_attached,
    Excute_Time,
    Excute_State
  ) VALUES (
    p_device_id,
    p_actor_id,
    v_source_type,
    p_payload,
    NOW(),
    'PENDING'
  );

  SET p_command_id = LAST_INSERT_ID();
END$$
 
-- IoT Server / Yolo phản hồi kết quả thực thi lệnh (success | failed)
DROP PROCEDURE IF EXISTS sp_update_command_result$$
CREATE PROCEDURE `sp_update_command_result`(
  IN p_command_id BIGINT,
  IN p_state VARCHAR(20)
)
BEGIN
  DECLARE v_target_state ENUM('PENDING', 'SUCCESS', 'FAILED', 'EXECUTED');
  
  IF UPPER(p_state) IN ('SUCCESS', 'EXECUTED') THEN
    SET v_target_state = 'SUCCESS';
  ELSE
    SET v_target_state = 'FAILED';
  END IF;

  UPDATE Device_Command
  SET Excute_State = v_target_state
  WHERE Command_ID = p_command_id;
END$$

-- ===== Giám sát môi trường (6.4) =====
-- Yolo gửi dữ liệu: backend xác định thiết bị/cảm biến theo Hardware_ID + loại dữ liệu
DROP PROCEDURE IF EXISTS sp_ingest_sensor_data$$
CREATE PROCEDURE sp_ingest_sensor_data(IN p_hardware_id VARCHAR(100), IN p_data_type VARCHAR(30),
                                       IN p_value DOUBLE, IN p_quality VARCHAR(30))
BEGIN
    DECLARE v_device INT DEFAULT NULL;
    DECLARE v_sensor INT DEFAULT NULL;
 
    SELECT Device_ID INTO v_device FROM Device WHERE Hardware_ID = p_hardware_id;
    IF v_device IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không xác định được thiết bị theo Hardware_ID';
    END IF;
    SELECT Sensor_ID INTO v_sensor FROM Sensor
    WHERE Device_ID = v_device AND Data_Type = p_data_type LIMIT 1;
    IF v_sensor IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Thiết bị không có cảm biến loại dữ liệu này';
    END IF;
    INSERT INTO Sensor_Record (Sensor_Value, Data_Quality, Sensor_ID)
    VALUES (p_value, COALESCE(LOWER(p_quality), 'good'), v_sensor);
    UPDATE Sensor SET Current_Value = p_value WHERE Sensor_ID = v_sensor;
END$$

DROP PROCEDURE IF EXISTS sp_yolo_heartbeat$$
CREATE PROCEDURE sp_yolo_heartbeat(IN p_controller_id INT, IN p_firmware VARCHAR(30))
BEGIN
    UPDATE Yolo_Controller
    SET Lastest_working_time = NOW(), Connection_State = 'online',
        Firmware_version = COALESCE(p_firmware, Firmware_version)
    WHERE Controller_ID = p_controller_id;
END$$
 
-- Thiết bị/bộ điều khiển không gửi tín hiệu quá p_timeout phút -> offline
DROP PROCEDURE IF EXISTS sp_check_offline_devices$$
CREATE PROCEDURE sp_check_offline_devices(IN p_timeout_minutes INT)
BEGIN
    UPDATE Device SET Connection_State = 'offline'
    WHERE LOWER(Connection_State) = 'online' AND Last_Connection_Time IS NOT NULL
      AND Last_Connection_Time < NOW() - INTERVAL p_timeout_minutes MINUTE;
 
    UPDATE Yolo_Controller SET Connection_State = 'offline'
    WHERE LOWER(Connection_State) = 'online' AND Lastest_working_time IS NOT NULL
      AND Lastest_working_time < NOW() - INTERVAL p_timeout_minutes MINUTE;
END$$
 
DROP PROCEDURE IF EXISTS sp_get_home_dashboard$$
CREATE PROCEDURE sp_get_home_dashboard(IN p_actor_id INT, IN p_home_id INT)
BEGIN
    IF NOT (fn_has_permission(p_actor_id, p_home_id, 'DEVICE_VIEW')
            AND fn_has_permission(p_actor_id, p_home_id, 'SENSOR_VIEW')) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền xem thông tin nhà';
    END IF;
 
    SELECT d.Device_ID, d.Device_Name, dt.Type_Name, d.Connection_State,
           d.Last_Connection_Time, ds.Current_State, d.Feed_Key
    FROM Device d
    JOIN Device_Type dt ON dt.Type_Code = d.Type_Code
    LEFT JOIN Device_State ds ON ds.Device_ID = d.Device_ID
    WHERE d.Home_ID = p_home_id;
 
    SELECT s.Sensor_ID, d.Device_Name, s.Data_Type, s.Unit,
           fn_latest_sensor_value(s.Sensor_ID) AS Latest_Value
    FROM Sensor s JOIN Device d ON d.Device_ID = s.Device_ID
    WHERE d.Home_ID = p_home_id;
END$$
 
DROP PROCEDURE IF EXISTS sp_get_sensor_history$$
CREATE PROCEDURE sp_get_sensor_history(IN p_actor_id INT, IN p_sensor_id INT, IN p_limit INT)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT d.Home_ID INTO v_home FROM Sensor s JOIN Device d ON d.Device_ID = s.Device_ID
    WHERE s.Sensor_ID = p_sensor_id;
    IF v_home IS NULL OR NOT fn_has_permission(p_actor_id, v_home, 'SENSOR_VIEW') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền xem dữ liệu cảm biến';
    END IF;
    SELECT Record_ID, Sensor_Value, Data_Quality, Time_Stamp FROM Sensor_Record
    WHERE Sensor_ID = p_sensor_id ORDER BY Time_Stamp DESC, Record_ID DESC LIMIT p_limit;
END$$
 
-- ===== Cửa mật mã (6.6, 6.7) =====
-- Tạo PIN (chủ nhà cấp cho mình, thành viên hoặc khách; khách nên có Valid_To)
DROP PROCEDURE IF EXISTS sp_create_access_credential$$
CREATE PROCEDURE sp_create_access_credential(IN p_actor_id INT, IN p_door_id INT, IN p_target_user_id INT,
                                             IN p_pin VARCHAR(100), IN p_valid_from DATETIME,
                                             IN p_valid_to DATETIME, OUT p_credential_id INT)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_ID = p_door_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cửa không tồn tại';
    END IF;
    IF NOT fn_has_permission(p_actor_id, v_home, 'DOOR_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý cửa';
    END IF;
    IF p_pin NOT REGEXP '^[0-9]{4,8}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PIN phải gồm 4-8 chữ số';
    END IF;
    -- trigger trg_access_credential_bi kiểm tra thành viên hợp lệ và khoảng thời gian
    INSERT INTO Access_Credential (Credential_Value, Credential_State, Valid_From, Valid_To, User_ID, Smart_Door_ID)
    VALUES (fn_hash_pin(p_door_id, p_target_user_id, p_pin), 'active', p_valid_from, p_valid_to,
            p_target_user_id, p_door_id);
    SET p_credential_id = LAST_INSERT_ID();
    CALL sp_log_activity(p_actor_id, v_home, 'access_credential', 'create_pin', 'web', 'success');
END$$
 
-- Nhập PIN tại cửa. p_result: success | failed | locked_out
DROP PROCEDURE IF EXISTS sp_verify_door_pin$$
CREATE PROCEDURE sp_verify_door_pin(IN p_door_id INT, IN p_pin VARCHAR(100),
                                    OUT p_result VARCHAR(20), OUT p_user_id INT)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    DECLARE v_user INT DEFAULT NULL;
 
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_ID = p_door_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cửa không tồn tại';
    END IF;
    SET p_user_id = NULL;
 
    IF fn_count_failed_attempts(p_door_id, 10) >= 5 THEN
        -- khóa tạm: sai từ 5 lần trong 10 phút
        INSERT INTO Access_Attempt (Verify_Method, Access_Result, Failure_Reason, Smart_Door_ID)
        VALUES ('pin', 'failed', 'locked_out', p_door_id);
        SET p_result = 'locked_out';
    ELSE
        SET v_user = fn_verify_pin(p_door_id, p_pin);
        IF v_user IS NULL THEN
            INSERT INTO Access_Attempt (Verify_Method, Access_Result, Failure_Reason, Smart_Door_ID)
            VALUES ('pin', 'failed', 'wrong_or_expired_pin', p_door_id);
            SET p_result = 'failed';
        ELSEIF NOT fn_has_permission(v_user, v_home, 'DOOR_UNLOCK') THEN
            INSERT INTO Access_Attempt (Verify_Method, Access_Result, Failure_Reason, User_ID, Smart_Door_ID)
            VALUES ('pin', 'failed', 'no_permission', v_user, p_door_id);
            SET p_result = 'failed';
        ELSE
            INSERT INTO Access_Attempt (Verify_Method, Access_Result, User_ID, Smart_Door_ID)
            VALUES ('pin', 'success', v_user, p_door_id);
            UPDATE Smart_Door SET Lock_Unlock_State = 'unlocked' WHERE Smart_Door_ID = p_door_id;
            CALL sp_log_activity(v_user, v_home, 'smart_door', 'unlock_by_pin', 'pin', 'success');
            SET p_result = 'success';
            SET p_user_id = v_user;
        END IF;
    END IF;
END$$
 
-- Chủ nhà đổi mật mã: xác thực mã hiện tại -> nhập mới 2 lần -> cập nhật -> ghi lịch sử
DROP PROCEDURE IF EXISTS sp_change_door_pin$$
CREATE PROCEDURE sp_change_door_pin(IN p_actor_id INT, IN p_credential_id INT, IN p_current_pin VARCHAR(100),
                                    IN p_new_pin VARCHAR(100), IN p_confirm_pin VARCHAR(100))
BEGIN
    DECLARE v_door INT DEFAULT NULL;
    DECLARE v_user INT DEFAULT NULL;
    DECLARE v_hash CHAR(64) DEFAULT NULL;
    DECLARE v_home INT DEFAULT NULL;
 
    SELECT Smart_Door_ID, User_ID, Credential_Value INTO v_door, v_user, v_hash
    FROM Access_Credential WHERE Credential_ID = p_credential_id;
    IF v_door IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mật mã không tồn tại';
    END IF;
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_ID = v_door;
 
    IF NOT fn_has_permission(p_actor_id, v_home, 'DOOR_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ chủ nhà mới được đổi mật mã';
    END IF;
    IF v_hash <> fn_hash_pin(v_door, v_user, p_current_pin) THEN
        CALL sp_log_activity(p_actor_id, v_home, 'access_credential', 'change_pin', 'web', 'failed');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mật mã hiện tại không đúng';
    END IF;
    IF p_new_pin <> p_confirm_pin THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hai lần nhập mật mã mới không khớp';
    END IF;
    IF p_new_pin NOT REGEXP '^[0-9]{4,8}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PIN phải gồm 4-8 chữ số';
    END IF;
    IF p_new_pin = p_current_pin THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mật mã mới phải khác mật mã hiện tại';
    END IF;
 
    UPDATE Access_Credential SET Credential_Value = fn_hash_pin(v_door, v_user, p_new_pin)
    WHERE Credential_ID = p_credential_id;
    CALL sp_log_activity(p_actor_id, v_home, 'access_credential', 'change_pin', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_revoke_credential$$
CREATE PROCEDURE sp_revoke_credential(IN p_actor_id INT, IN p_credential_id INT)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT sd.Home_ID INTO v_home
    FROM Access_Credential ac JOIN Smart_Door sd ON sd.Smart_Door_ID = ac.Smart_Door_ID
    WHERE ac.Credential_ID = p_credential_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mật mã không tồn tại';
    END IF;
    IF NOT fn_has_permission(p_actor_id, v_home, 'DOOR_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý cửa';
    END IF;
    UPDATE Access_Credential SET Credential_State = 'revoked' WHERE Credential_ID = p_credential_id;
    CALL sp_log_activity(p_actor_id, v_home, 'access_credential', 'revoke_pin', 'web', 'success');
END$$
 
-- Chủ nhà mở/khóa cửa từ xa
DROP PROCEDURE IF EXISTS sp_set_door_state$$
CREATE PROCEDURE sp_set_door_state(IN p_actor_id INT, IN p_door_id INT, IN p_state VARCHAR(20))
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_ID = p_door_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cửa không tồn tại';
    END IF;
    IF LOWER(p_state) NOT IN ('locked', 'unlocked') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trạng thái phải là locked hoặc unlocked';
    END IF;
    IF NOT fn_has_permission(p_actor_id, v_home, 'DOOR_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền điều khiển cửa từ xa';
    END IF;
 
    UPDATE Smart_Door SET Lock_Unlock_State = LOWER(p_state) WHERE Smart_Door_ID = p_door_id;
    IF LOWER(p_state) = 'unlocked' THEN
        INSERT INTO Access_Attempt (Verify_Method, Access_Result, User_ID, Smart_Door_ID)
        VALUES ('remote', 'success', p_actor_id, p_door_id);
    END IF;
    CALL sp_log_activity(p_actor_id, v_home, 'smart_door', CONCAT('set_', LOWER(p_state)), 'remote', 'success');
END$$
 
-- ===== FaceAI (6.9) =====
DROP PROCEDURE IF EXISTS sp_register_face_profile$$
CREATE PROCEDURE `sp_register_face_profile`(
  IN p_actor_id INT,
  IN p_home_id INT,
  IN p_target_user_id INT,
  IN p_valid_from DATETIME,
  IN p_valid_to DATETIME,
  OUT p_profile_id INT
)
BEGIN
  DECLARE v_existing_id INT;

  -- Kiểm tra hồ sơ trong cùng một ngôi nhà
  SELECT Face_Profile_ID INTO v_existing_id
  FROM Face_Profile
  WHERE User_ID = p_target_user_id AND Home_ID = p_home_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Nếu đã có thì cập nhật lại hạn sử dụng
    UPDATE Face_Profile
    SET Valid_From = p_valid_from,
        Valid_To = p_valid_to
    WHERE Face_Profile_ID = v_existing_id;
    SET p_profile_id = v_existing_id;
  ELSE
    INSERT INTO Face_Profile (Home_ID, User_ID, Valid_From, Valid_To, Created_At)
    VALUES (p_home_id, p_target_user_id, p_valid_from, p_valid_to, NOW());
    SET p_profile_id = LAST_INSERT_ID();
  END IF;
END$$
 
-- Kích hoạt / vô hiệu hóa khuôn mặt bằng cách đặt lại khoảng hiệu lực
DROP PROCEDURE IF EXISTS sp_set_face_profile_validity$$
CREATE PROCEDURE sp_set_face_profile_validity(IN p_actor_id INT, IN p_profile_id INT,
                                              IN p_valid_from DATETIME, IN p_valid_to DATETIME)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT Home_ID INTO v_home FROM Face_Profile WHERE Face_Profile_ID = p_profile_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FaceProfile không tồn tại';
    END IF;
    IF NOT fn_has_permission(p_actor_id, v_home, 'FACE_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý FaceAI';
    END IF;
    UPDATE Face_Profile SET Valid_From = p_valid_from, Valid_To = p_valid_to
    WHERE Face_Profile_ID = p_profile_id;
    CALL sp_log_activity(p_actor_id, v_home, 'face_profile', 'update_validity', 'web', 'success');
END$$
 
DROP PROCEDURE IF EXISTS sp_delete_face_profile$$
CREATE PROCEDURE sp_delete_face_profile(IN p_actor_id INT, IN p_profile_id INT)
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    SELECT Home_ID INTO v_home FROM Face_Profile WHERE Face_Profile_ID = p_profile_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FaceProfile không tồn tại';
    END IF;
    IF NOT fn_has_permission(p_actor_id, v_home, 'FACE_MANAGE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền quản lý FaceAI';
    END IF;
    DELETE FROM Face_Profile WHERE Face_Profile_ID = p_profile_id;
    CALL sp_log_activity(p_actor_id, v_home, 'face_profile', 'delete_face', 'web', 'success');
END$$
 
-- AI service trả kết quả nhận diện tại cửa. p_reliability: 0..100. p_decision: allowed | denied
DROP PROCEDURE IF EXISTS sp_record_face_recognition$$
CREATE PROCEDURE sp_record_face_recognition(IN p_door_id INT, IN p_face_profile_id INT,
                                            IN p_label VARCHAR(100), IN p_reliability DECIMAL(5,2),
                                            IN p_threshold DECIMAL(5,2), OUT p_decision VARCHAR(10))
BEGIN
    DECLARE v_home INT DEFAULT NULL;
    DECLARE v_prof_home INT DEFAULT NULL;
    DECLARE v_user INT DEFAULT NULL;
    DECLARE v_from DATETIME DEFAULT NULL;
    DECLARE v_to DATETIME DEFAULT NULL;
    DECLARE v_result VARCHAR(50);
    DECLARE v_reason VARCHAR(100) DEFAULT NULL;
    DECLARE v_profile INT DEFAULT p_face_profile_id;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
 
    SELECT Home_ID INTO v_home FROM Smart_Door WHERE Smart_Door_ID = p_door_id;
    IF v_home IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cửa không tồn tại';
    END IF;
 
    IF v_profile IS NOT NULL THEN
        SELECT User_ID, Valid_From, Valid_To, Home_ID INTO v_user, v_from, v_to, v_prof_home
        FROM Face_Profile WHERE Face_Profile_ID = v_profile;
        IF v_prof_home IS NULL OR v_prof_home <> v_home THEN
            SET v_profile = NULL;      -- khuôn mặt không thuộc nhà này -> coi như người lạ
            SET v_user = NULL;
        END IF;
    END IF;
 
    IF v_profile IS NULL THEN
        SET v_result = 'unknown';         SET v_reason = 'unknown_face';
    ELSEIF (v_from IS NOT NULL AND v_from > NOW()) OR (v_to IS NOT NULL AND v_to < NOW()) THEN
        SET v_result = 'expired';         SET v_reason = 'profile_expired';
    ELSEIF p_reliability < p_threshold THEN
        SET v_result = 'low_confidence';  SET v_reason = 'low_confidence';
    ELSEIF NOT fn_has_permission(v_user, v_home, 'DOOR_UNLOCK') THEN
        SET v_result = 'no_permission';   SET v_reason = 'no_permission';
    ELSE
        SET v_result = 'recognized';
    END IF;
 
    START TRANSACTION;
    INSERT INTO Face_Recognition_Event (Reliability, Label, Recognization_Result,
                                        Face_Profile_ID, Smart_Door_ID, Home_ID)
    VALUES (p_reliability, p_label, v_result, v_profile, p_door_id, v_home);
 
    IF v_reason IS NULL THEN
        INSERT INTO Access_Attempt (Verify_Method, Access_Result, User_ID, Smart_Door_ID)
        VALUES ('face', 'success', v_user, p_door_id);
        UPDATE Smart_Door SET Lock_Unlock_State = 'unlocked' WHERE Smart_Door_ID = p_door_id;
        CALL sp_log_activity(v_user, v_home, 'smart_door', 'unlock_by_face', 'face', 'success');
        SET p_decision = 'allowed';
    ELSE
        INSERT INTO Access_Attempt (Verify_Method, Access_Result, Failure_Reason, User_ID, Smart_Door_ID)
        VALUES ('face', 'failed', v_reason, v_user, p_door_id);
        SET p_decision = 'denied';
    END IF;
    COMMIT;
END$$
 
-- ===== Giọng nói (6.8) =====
-- Đã có văn bản + thiết bị + dữ liệu lệnh sau bước speech-to-text/phân tích từ khóa.
-- Không xác định được thiết bị hoặc không đủ quyền -> 'unsupported' (trigger sẽ cảnh báo).
DROP PROCEDURE IF EXISTS sp_process_voice_command$$
CREATE PROCEDURE sp_process_voice_command(
    IN p_user_id INT,
    IN p_home_id INT,
    IN p_command_detail TEXT,
    IN p_device_name VARCHAR(255),
    IN p_command_data JSON,
    IN p_language VARCHAR(20),
    OUT p_voice_id INT,
    OUT p_state VARCHAR(30),
    OUT p_target_device_id INT,
    OUT p_feed_key VARCHAR(100)
)
proc_label: BEGIN
    DECLARE v_device_id INT DEFAULT NULL;
    DECLARE v_feed VARCHAR(100) DEFAULT NULL;
    DECLARE v_has_permission BOOLEAN DEFAULT FALSE;
    DECLARE v_is_owner BOOLEAN DEFAULT FALSE;
    DECLARE v_clean_name VARCHAR(255);

    SET p_voice_id = NULL;
    SET p_state = 'unsupported';
    SET p_target_device_id = NULL;
    SET p_feed_key = NULL;

    -- 1. Kiểm tra quyền: Chủ nhà (Owner) luôn có quyền; thành viên khác kiểm tra fn_has_permission
    SELECT EXISTS (
        SELECT 1 FROM Home 
        WHERE Home_ID = p_home_id AND Owner_ID = p_user_id
    ) INTO v_is_owner;

    IF v_is_owner THEN
        SET v_has_permission = TRUE;
    ELSE
        SET v_has_permission = fn_has_permission(p_user_id, p_home_id, 'VOICE_USE');
    END IF;

    IF NOT v_has_permission THEN
        SET p_state = 'unsupported';
        LEAVE proc_label;
    END IF;

    -- 2. Tìm thiết bị linh hoạt
    SET v_clean_name = LOWER(TRIM(COALESCE(p_device_name, '')));

    -- 2.1. Tìm theo tên (khớp chính xác hoặc chứa từ khóa LIKE)
    IF v_clean_name <> '' THEN
        SELECT Device_ID, Feed_Key INTO v_device_id, v_feed
        FROM Device 
        WHERE Home_ID = p_home_id 
          AND (
              LOWER(Device_Name) = v_clean_name
              OR LOWER(Device_Name) LIKE CONCAT('%', v_clean_name, '%')
          )
        ORDER BY (LOWER(Device_Name) = v_clean_name) DESC
        LIMIT 1;
    END IF;

    -- 2.2. Nếu chưa thấy, map từ khóa chung sang Type_Code / Nhóm thiết bị
    IF v_device_id IS NULL AND v_clean_name <> '' THEN
        IF v_clean_name LIKE '%đèn%' OR v_clean_name LIKE '%light%' THEN
            SELECT Device_ID, Feed_Key INTO v_device_id, v_feed
            FROM Device
            WHERE Home_ID = p_home_id AND (UPPER(Type_Code) LIKE '%LIGHT%' OR UPPER(Device_Name) LIKE '%ĐÈN%')
            LIMIT 1;
        ELSEIF v_clean_name LIKE '%quạt%' OR v_clean_name LIKE '%fan%' THEN
            SELECT Device_ID, Feed_Key INTO v_device_id, v_feed
            FROM Device
            WHERE Home_ID = p_home_id AND (UPPER(Type_Code) LIKE '%FAN%' OR UPPER(Device_Name) LIKE '%QUẠT%')
            LIMIT 1;
        ELSEIF v_clean_name LIKE '%cửa%' OR v_clean_name LIKE '%door%' THEN
            SELECT Device_ID, Feed_Key INTO v_device_id, v_feed
            FROM Device
            WHERE Home_ID = p_home_id AND (UPPER(Type_Code) LIKE '%DOOR%' OR UPPER(Device_Name) LIKE '%CỬA%')
            LIMIT 1;
        END IF;
    END IF;

    -- 3. Xác định trạng thái kết quả
    IF v_device_id IS NULL THEN
        SET p_state = 'unsupported';
    ELSE
        SET p_state = 'sent';
        SET p_target_device_id = v_device_id;
        SET p_feed_key = v_feed;
    END IF;

    -- 4. Lưu lịch sử vào Voice_Command
    INSERT INTO Voice_Command (
        Command_Detail, 
        Working_State, 
        Device, 
        User_ID, 
        Home_ID, 
        Command_Data, 
        `Language`
    ) VALUES (
        p_command_detail, 
        p_state, 
        v_device_id, 
        p_user_id, 
        p_home_id, 
        p_command_data, 
        p_language
    );

    SET p_voice_id = LAST_INSERT_ID();
END$$

-- ===== Thông báo & lịch sử (6.10) =====
-- p_notification_id = NULL -> đánh dấu đã đọc tất cả
DROP PROCEDURE IF EXISTS sp_mark_notifications_read$$
CREATE PROCEDURE sp_mark_notifications_read(
    IN p_user_id INT, 
    IN p_notification_id INT
)
BEGIN
    UPDATE Notification 
    SET Unread_Read = 'Read'
    WHERE User_ID = p_user_id 
      AND Unread_Read = 'Unread'
      AND (p_notification_id IS NULL OR p_notification_id <= 0 OR Notification_ID = p_notification_id);
END$$
 
-- Chủ nhà xem toàn bộ; thành viên chỉ xem lịch sử của chính mình
DROP PROCEDURE IF EXISTS sp_get_activity_history$$
CREATE PROCEDURE sp_get_activity_history(IN p_actor_id INT, IN p_home_id INT, IN p_limit INT)
BEGIN
    IF fn_has_permission(p_actor_id, p_home_id, 'LOG_VIEW_ALL') THEN
        SELECT Activity_Log_ID, User_ID, Entity_Type, `Action`, `Source`, `Result`, `Time`
        FROM Activity_Log WHERE Home_ID = p_home_id
        ORDER BY Activity_Log_ID DESC LIMIT p_limit;
    ELSEIF fn_has_permission(p_actor_id, p_home_id, 'LOG_VIEW_OWN') THEN
        SELECT Activity_Log_ID, User_ID, Entity_Type, `Action`, `Source`, `Result`, `Time`
        FROM Activity_Log WHERE Home_ID = p_home_id AND User_ID = p_actor_id
        ORDER BY Activity_Log_ID DESC LIMIT p_limit;
    ELSE
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không có quyền xem lịch sử';
    END IF;
END$$

DELIMITER ;




