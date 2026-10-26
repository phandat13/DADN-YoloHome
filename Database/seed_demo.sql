-- Dữ liệu mẫu để demo (chạy SAU init.sql):
--   cd Database
--   mysql --default-character-set=utf8mb4 -u root -p < seed_demo.sql
--
-- Tài khoản (mật khẩu đều là 123456):
--   owner@yolohome.local   – Chủ nhà (Owner)
--   member@yolohome.local  – Thành viên (Member)
--   guest@yolohome.local   – Khách (Guest, hết hạn sau 30 ngày)
-- Cửa "Cửa chính" có mã PIN 1234 của chủ nhà.
SET NAMES utf8mb4;
USE smart_home;

SET @pw = '$2b$10$o9wVXDI6TmaKbfmggNlbGOseYKawBzBV3ZhXGWaPcJMckyH3INVNK';  -- bcrypt('123456')

INSERT INTO `User` (`Name`, Email, `Password`, Display_name) VALUES
  ('Chủ nhà Demo',    'owner@yolohome.local',  @pw, 'Chủ nhà'),
  ('Thành viên Demo', 'member@yolohome.local', @pw, 'Thành viên'),
  ('Khách Demo',      'guest@yolohome.local',  @pw, 'Khách');
SET @owner  = (SELECT User_ID FROM `User` WHERE Email = 'owner@yolohome.local');
SET @member = (SELECT User_ID FROM `User` WHERE Email = 'member@yolohome.local');
SET @guest  = (SELECT User_ID FROM `User` WHERE Email = 'guest@yolohome.local');

-- Trigger trg_home_ai tự thêm chủ nhà (Owner) và dòng Home_Setting
INSERT INTO Home (Home_Name, Address, Owner_ID) VALUES ('Nhà Demo', 'TP. Hồ Chí Minh', @owner);
SET @home = LAST_INSERT_ID();

INSERT INTO Home_Member (`Status`, Expired, User_ID, Home_ID, Role_ID)
SELECT 'active', NULL, @member, @home, Role_ID FROM Role WHERE Role_Name = 'Member';
INSERT INTO Home_Member (`Status`, Expired, User_ID, Home_ID, Role_ID)
SELECT 'active', NOW() + INTERVAL 30 DAY, @guest, @home, Role_ID FROM Role WHERE Role_Name = 'Guest';

-- Thiết bị (mỗi loại 1 cái, đúng mô hình phần cứng trong giáo trình)
INSERT INTO Device (Device_Name, Available_working_State, Home_ID, Type_Code, Feed_Key, Color) VALUES
  ('Đèn phòng khách',  'off', @home, 'LIGHT',  'device-light', '#FFFFFF'),
  ('Quạt phòng khách', '0',   @home, 'FAN',    'device-fan',   NULL),
  ('Cụm cảm biến',     'off', @home, 'SENSOR', 'hardware-log', NULL),
  ('Còi cảnh báo',     'off', @home, 'BUZZER', 'hardware-log', NULL);
SET @sensor_dev = (SELECT Device_ID FROM Device WHERE Home_ID = @home AND Type_Code = 'SENSOR' LIMIT 1);

INSERT INTO Sensor (Sensor_Name, Sensor_Type, Unit, Feed_Key, Sampling_Cycle, Device_ID) VALUES
  ('Nhiệt độ - DHT20',     'TEMPERATURE', '°C',  'sensor-temperature', 10, @sensor_dev),
  ('Độ ẩm - DHT20',        'HUMIDITY',    '%',   'sensor-humidity',    10, @sensor_dev),
  ('Ánh sáng',             'LIGHT',       'Lux', 'sensor-light',       10, @sensor_dev),
  ('Chuyển động - PIR',    'MOTION',      '',    'sensor-motion',      1,  @sensor_dev);

-- 24 giờ dữ liệu mẫu, mỗi 30 phút 1 điểm
INSERT INTO Sensor_Record (Sensor_ID, Sensor_Value, Data_Quality, Time_Stamp)
WITH RECURSIVE t (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM t WHERE n < 47)
SELECT s.Sensor_ID,
       CASE s.Sensor_Type
         WHEN 'TEMPERATURE' THEN ROUND(29 + 4 * SIN(n / 7.6), 1)
         WHEN 'HUMIDITY'    THEN ROUND(65 - 10 * SIN(n / 7.6), 1)
         WHEN 'LIGHT'       THEN ROUND(GREATEST(20, 450 * SIN(n / 15.2)), 0)
         ELSE IF(n % 6 = 0, 1, 0)
       END,
       'good',
       NOW() - INTERVAL (47 - n) * 30 MINUTE
FROM Sensor s CROSS JOIN t
WHERE s.Device_ID = @sensor_dev;

UPDATE Sensor s
SET Current_Value = fn_latest_sensor_value(s.Sensor_ID), Last_Updated = NOW()
WHERE s.Device_ID = @sensor_dev;

-- Cửa + mã PIN 1234 cho chủ nhà
INSERT INTO Smart_Door (Smart_Door_Name, Home_ID) VALUES ('Cửa chính', @home);
SET @door = LAST_INSERT_ID();
INSERT INTO Access_Credential (Credential_Value, User_ID, Smart_Door_ID)
VALUES (fn_hash_pin(@door, @owner, '1234'), @owner, @door);

SELECT 'Đã tạo dữ liệu demo' AS Ket_qua, @home AS Home_ID, @door AS Smart_Door_ID;
