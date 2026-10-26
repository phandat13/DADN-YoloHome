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

-- Băm PIN có "muối" theo cửa (Smart_Door_ID) + người dùng (PIN không lưu dạng rõ)
DROP FUNCTION IF EXISTS fn_hash_pin$$
CREATE FUNCTION fn_hash_pin(p_door_id INT, p_user_id INT, p_pin VARCHAR(100))
RETURNS CHAR(64) DETERMINISTIC NO SQL
BEGIN
    RETURN SHA2(CONCAT('door#', p_door_id, ':', p_user_id, ':', p_pin), 256);
END$$

DROP FUNCTION IF EXISTS fn_is_valid_email$$
CREATE FUNCTION fn_is_valid_email(p_email VARCHAR(150))
RETURNS TINYINT(1) DETERMINISTIC NO SQL
BEGIN
    RETURN p_email REGEXP '^[^@ ]+@[^@ ]+[.][^@ ]+$';
END$$

-- Người dùng là thành viên còn hiệu lực của nhà?
DROP FUNCTION IF EXISTS fn_is_home_member$$
CREATE FUNCTION fn_is_home_member(p_user_id INT, p_home_id INT)
RETURNS TINYINT(1) READS SQL DATA
BEGIN
    RETURN EXISTS (SELECT 1 FROM Home_Member
                   WHERE User_ID = p_user_id AND Home_ID = p_home_id
                     AND LOWER(`Status`) = 'active'
                     AND (Expired IS NULL OR Expired > NOW()));
END$$

-- Vai trò hiện tại của người dùng trong nhà (NULL nếu không phải thành viên hợp lệ)
DROP FUNCTION IF EXISTS fn_get_home_role$$
CREATE FUNCTION fn_get_home_role(p_user_id INT, p_home_id INT)
RETURNS VARCHAR(50) READS SQL DATA
BEGIN
    DECLARE v_role VARCHAR(50) DEFAULT NULL;
    SELECT r.Role_Name INTO v_role
    FROM Home_Member hm JOIN Role r ON r.Role_ID = hm.Role_ID
    WHERE hm.User_ID = p_user_id AND hm.Home_ID = p_home_id
      AND LOWER(hm.`Status`) = 'active'
      AND (hm.Expired IS NULL OR hm.Expired > NOW())
    LIMIT 1;
    RETURN v_role;
END$$

-- Kiểm tra quyền theo permission_code (Role -> Role_Permission -> Permission)
DROP FUNCTION IF EXISTS fn_has_permission$$
CREATE FUNCTION fn_has_permission(
    p_user_id INT,
    p_home_id INT,
    p_permission_code VARCHAR(50)
) 
RETURNS TINYINT(1)
READS SQL DATA
BEGIN
    DECLARE v_is_owner INT DEFAULT 0;
    DECLARE v_has_perm INT DEFAULT 0;

    -- 1. Nếu là Chủ nhà của ngôi nhà này -> Toàn quyền (trả về 1 ngay lập tức)
    SELECT COUNT(*) INTO v_is_owner
    FROM Home
    WHERE Home_ID = p_home_id AND Owner_ID = p_user_id;

    IF v_is_owner > 0 THEN
        RETURN 1;
    END IF;

    -- 2. Nếu là thành viên, kiểm tra qua bảng Home_Member -> Role_Permission -> Permission
    SELECT COUNT(*) INTO v_has_perm
    FROM Home_Member hm
    JOIN Role_Permission rp ON hm.Role_ID = rp.Role_ID
    JOIN Permission p ON rp.Permission_ID = p.Permission_ID
    WHERE hm.User_ID = p_user_id
      AND hm.Home_ID = p_home_id
      AND LOWER(hm.`Status`) = 'active'
      AND (hm.Expired IS NULL OR hm.Expired > NOW())
      AND p.Permission_Code = p_permission_code;

    IF v_has_perm > 0 THEN
        RETURN 1;
    END IF;

    RETURN 0;
END$$

-- Xác thực PIN: trả về User_ID sở hữu PIN hợp lệ, NULL nếu sai/hết hạn/bị thu hồi
DROP FUNCTION IF EXISTS fn_verify_pin$$
CREATE FUNCTION fn_verify_pin(p_door_id INT, p_pin VARCHAR(100))
RETURNS INT READS SQL DATA
BEGIN
    DECLARE v_user INT DEFAULT NULL;
    SELECT User_ID INTO v_user
    FROM Access_Credential
    WHERE Smart_Door_ID = p_door_id
      AND LOWER(Credential_State) = 'active'
      AND (Valid_From IS NULL OR Valid_From <= NOW())
      AND (Valid_To   IS NULL OR Valid_To   >= NOW())
      AND Credential_Value = fn_hash_pin(p_door_id, User_ID, p_pin)
    LIMIT 1;
    RETURN v_user;
END$$

-- Số lần truy cập thất bại gần đây (không tính các lần bị khóa tạm)
DROP FUNCTION IF EXISTS fn_count_failed_attempts$$
CREATE FUNCTION fn_count_failed_attempts(p_door_id INT, p_minutes INT)
RETURNS INT READS SQL DATA
BEGIN
    DECLARE v_cnt INT DEFAULT 0;
    SELECT COUNT(*) INTO v_cnt
    FROM Access_Attempt
    WHERE Smart_Door_ID = p_door_id
      AND LOWER(Access_Result) = 'failed'
      AND (Failure_Reason IS NULL OR Failure_Reason <> 'locked_out')
      AND `Time` >= NOW() - INTERVAL p_minutes MINUTE;
    RETURN v_cnt;
END$$

-- Giá trị đo mới nhất của cảm biến
DROP FUNCTION IF EXISTS fn_latest_sensor_value$$
CREATE FUNCTION fn_latest_sensor_value(p_sensor_id INT)
RETURNS DOUBLE READS SQL DATA
BEGIN
    DECLARE v_val DOUBLE DEFAULT NULL;
    SELECT Sensor_Value INTO v_val
    FROM Sensor_Record
    WHERE Sensor_ID = p_sensor_id
    ORDER BY Time_Stamp DESC, Record_ID DESC
    LIMIT 1;
    RETURN v_val;
END$$

DROP FUNCTION IF EXISTS fn_unread_notifications$$
CREATE FUNCTION fn_unread_notifications(p_user_id INT)
RETURNS INT READS SQL DATA
BEGIN
    DECLARE v_cnt INT DEFAULT 0;
    SELECT COUNT(*) INTO v_cnt FROM Notification
    WHERE User_ID = p_user_id AND Unread_Read = 'Unread';
    RETURN v_cnt;
END$$

-- Xác định người yêu cầu của một lệnh thiết bị (user -> Source_ID, voice -> chủ VoiceCommand)
DROP FUNCTION IF EXISTS fn_command_requester$$
CREATE FUNCTION fn_command_requester (
  p_source_type VARCHAR(50),
  p_source_id INT
) RETURNS VARCHAR(100)
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE v_name VARCHAR(100);
  
  IF UPPER(p_source_type) IN ('VOICE_COMMAND', 'VOICE') THEN
    SELECT COALESCE(Display_name, Name) INTO v_name
    FROM `User`
    WHERE User_ID = p_source_id;
    RETURN CONCAT('Giọng nói (', COALESCE(v_name, 'Không rõ'), ')');
  ELSEIF UPPER(p_source_type) = 'USER' THEN
    SELECT COALESCE(Display_name, Name) INTO v_name
    FROM `User`
    WHERE User_ID = p_source_id;
    RETURN COALESCE(v_name, 'Người dùng');
  ELSEIF UPPER(p_source_type) = 'SCHEDULE' THEN
    RETURN 'Lịch tự động';
  ELSE
    RETURN 'Hệ thống';
  END IF;
END$$

DELIMITER ;



