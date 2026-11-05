-- Nâng cấp DB đang chạy (KHÔNG xoá dữ liệu) cho tính năng: chế độ ngủ, ưu tiên lệnh giọng nói, hẹn giờ thiết bị.
-- Chạy 1 lần:  cd Database && mysql --default-character-set=utf8mb4 -u root -p < migrations/2026-11-05_sleep_schedule.sql
-- (DB tạo mới bằng init.sql đã có sẵn các cột / bảng này.)
SET NAMES utf8mb4;
USE smart_home;

DROP PROCEDURE IF EXISTS tmp_add_col;
DELIMITER $$
CREATE PROCEDURE tmp_add_col(IN p_col VARCHAR(64), IN p_def VARCHAR(255))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Home_Setting' AND COLUMN_NAME = p_col) THEN
    SET @sql = CONCAT('ALTER TABLE Home_Setting ADD COLUMN ', p_col, ' ', p_def);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;

CALL tmp_add_col('Sleep_Enabled', "BOOLEAN NOT NULL DEFAULT TRUE");
CALL tmp_add_col('Sleep_Start', "TIME NOT NULL DEFAULT '22:30:00'");
CALL tmp_add_col('Sleep_End', "TIME NOT NULL DEFAULT '06:00:00'");
CALL tmp_add_col('Sleep_Manual', "ENUM('NONE','SLEEP','AWAKE') NOT NULL DEFAULT 'NONE'");
CALL tmp_add_col('Sleep_Manual_Until', "DATETIME NULL");
CALL tmp_add_col('Override_Minutes', "INT NOT NULL DEFAULT 30");
DROP PROCEDURE tmp_add_col;

CREATE TABLE IF NOT EXISTS Device_Schedule (
    Schedule_ID INT AUTO_INCREMENT PRIMARY KEY,
    Home_ID INT NOT NULL,
    Device_ID INT NOT NULL,
    `Action` VARCHAR(20) NOT NULL,
    Speed TINYINT UNSIGNED NULL,
    Color CHAR(7) NULL,
    Repeat_Type ENUM('ONCE','REPEAT') NOT NULL DEFAULT 'ONCE',
    Time_Of_Day TIME NULL,
    Days_Mask TINYINT UNSIGNED NOT NULL DEFAULT 127,
    Next_Run_At DATETIME NULL,
    Enabled BOOLEAN NOT NULL DEFAULT TRUE,
    Created_Via ENUM('WEB','VOICE') NOT NULL DEFAULT 'WEB',
    Note VARCHAR(100) NULL,
    Last_Run_At DATETIME NULL,
    Last_Result VARCHAR(20) NULL,
    Created_By INT NULL,
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_schedule_due (Enabled, Next_Run_At),
    CONSTRAINT fk_ds_home FOREIGN KEY (Home_ID) REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ds_device FOREIGN KEY (Device_ID) REFERENCES Device(Device_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ds_user FOREIGN KEY (Created_By) REFERENCES `User`(User_ID) ON DELETE SET NULL ON UPDATE CASCADE
);

SELECT 'Đã nâng cấp: chế độ ngủ + hẹn giờ thiết bị' AS Ket_qua;
