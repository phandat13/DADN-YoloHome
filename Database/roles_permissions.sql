USE smart_home;

-- 1. Vai trò
INSERT IGNORE INTO Role (Role_Name) VALUES ('Owner'), ('Member'), ('Guest');

-- 2. Quyền hạn
INSERT IGNORE INTO Permission (Permission_Code, Permission_Name, Permission_Module, Permission_Description) VALUES
 ('HOME_UPDATE', 'Cập nhật thông tin nhà', 'HOME', 'Sửa tên, địa chỉ, trạng thái nhà'),
 ('HOME_DELETE', 'Xóa nhà', 'HOME', 'Xóa toàn bộ nhà'),
 ('MEMBER_MANAGE', 'Quản lý thành viên', 'MEMBER', 'Thêm, xóa, đổi vai trò thành viên'),
 ('DEVICE_VIEW', 'Xem thiết bị', 'DEVICE', 'Xem danh sách và trạng thái thiết bị'),
 ('DEVICE_CONTROL', 'Điều khiển thiết bị', 'DEVICE', 'Bật/tắt, điều chỉnh thiết bị'),
 ('DEVICE_MANAGE', 'Quản lý thiết bị', 'DEVICE', 'Thêm, cấu hình thiết bị'),
 ('SENSOR_VIEW', 'Xem dữ liệu cảm biến', 'MONITOR', 'Xem dữ liệu môi trường hiện tại và lịch sử'),
 ('DOOR_UNLOCK', 'Mở cửa', 'SMART_DOOR', 'Mở cửa bằng PIN hoặc FaceAI'),
 ('DOOR_MANAGE', 'Quản lý cửa thông minh', 'SMART_DOOR', 'Tạo, đổi, thu hồi mật mã; mở cửa từ xa'),
 ('FACE_MANAGE', 'Quản lý FaceAI', 'FACE_AI', 'Thêm, sửa, xóa, kích hoạt khuôn mặt'),
 ('VOICE_USE', 'Dùng điều khiển giọng nói', 'VOICE', 'Ra lệnh bằng giọng nói'),
 ('LOG_VIEW_ALL', 'Xem toàn bộ lịch sử', 'HISTORY', 'Xem lịch sử hoạt động của mọi thành viên'),
 ('LOG_VIEW_OWN', 'Xem lịch sử của mình', 'HISTORY', 'Chỉ xem lịch sử do chính mình thực hiện'),
 ('NOTIFICATION_VIEW', 'Xem thông báo', 'NOTIFICATION', 'Nhận và xem thông báo');

-- 3. Loại thiết bị hỗ trợ
INSERT IGNORE INTO Device_Type (Type_Code, Type_Name, Type_Group, Supported, Manufacturer) VALUES
('LIGHT', 'Đèn chiếu sáng / LED', 'actuator', 1, 'OhStem'),
('FAN', 'Quạt làm mát', 'actuator', 1, 'OhStem'),
('SENSOR', 'Cụm cảm biến', 'sensor', 1, 'OhStem'),
('DOOR_LOCK', 'Khóa cửa thông minh', 'security', 1, 'YoloHome'),
('BUZZER', 'Còi cảnh báo', 'actuator', 1, 'OhStem');

-- 4. Phân quyền cho từng vai trò
-- Owner: toàn quyền
INSERT IGNORE INTO Role_Permission (Role_ID, Permission_ID)
SELECT r.Role_ID, p.Permission_ID FROM Role r CROSS JOIN Permission p
WHERE r.Role_Name = 'Owner';

-- Member: giám sát, điều khiển thiết bị, giọng nói, thông báo, lịch sử của mình
INSERT IGNORE INTO Role_Permission (Role_ID, Permission_ID)
SELECT r.Role_ID, p.Permission_ID FROM Role r CROSS JOIN Permission p
WHERE r.Role_Name = 'Member'
  AND p.Permission_Code IN ('DEVICE_VIEW','DEVICE_CONTROL','SENSOR_VIEW','DOOR_UNLOCK',
                            'VOICE_USE','LOG_VIEW_OWN','NOTIFICATION_VIEW');

-- Guest: chỉ được mở cửa (PIN/Face tạm thời)
INSERT IGNORE INTO Role_Permission (Role_ID, Permission_ID)
SELECT r.Role_ID, p.Permission_ID FROM Role r CROSS JOIN Permission p
WHERE r.Role_Name = 'Guest' AND p.Permission_Code IN ('DOOR_UNLOCK');

-- 5. Cập nhật Feed_Key chuẩn cho các thiết bị đang có trong hệ thống (nếu có)
UPDATE Device 
SET Feed_Key = 'device-light' 
WHERE UPPER(Type_Code) LIKE '%LIGHT%' OR UPPER(Device_Name) LIKE '%ĐÈN%';

UPDATE Device 
SET Feed_Key = 'device-fan' 
WHERE UPPER(Type_Code) LIKE '%FAN%' OR UPPER(Device_Name) LIKE '%QUẠT%';

UPDATE Device 
SET Feed_Key = 'smart-door' 
WHERE UPPER(Type_Code) LIKE '%DOOR%' OR UPPER(Device_Name) LIKE '%CỬA%';

INSERT INTO Home_Member (`Status`, User_ID, Home_ID, Role_ID, Joined)
SELECT 
    'active',
    h.Owner_ID,
    h.Home_ID,
    r.Role_ID,
    NOW()
FROM Home h
JOIN `Role` r ON r.Role_Name = 'Owner'
ON DUPLICATE KEY UPDATE 
    `Status` = 'active',
    Role_ID = VALUES(Role_ID);

INSERT IGNORE INTO Role_Permission (Role_ID, Permission_ID)
SELECT r.Role_ID, p.Permission_ID 
FROM Role r 
CROSS JOIN Permission p
WHERE r.Role_Name = 'Owner';

