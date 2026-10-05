USE smart_home;

INSERT IGNORE INTO Role (Role_Name) VALUES ('Owner'),('Member'), ('Guest');

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
 ('VOICE_USE', 'Dùng điều khiển giọng nói','VOICE', 'Ra lệnh bằng giọng nói'),
 ('LOG_VIEW_ALL', 'Xem toàn bộ lịch sử', 'HISTORY', 'Xem lịch sử hoạt động của mọi thành viên'),
 ('LOG_VIEW_OWN', 'Xem lịch sử của mình', 'HISTORY', 'Chỉ xem lịch sử do chính mình thực hiện'),
 ('NOTIFICATION_VIEW','Xem thông báo', 'NOTIFICATION', 'Nhận và xem thông báo');

INSERT IGNORE INTO Device_Type (Type_Code, Type_Name, Type_Group, Supported, Manufacturer) VALUES
('LIGHT_RGB', 'Đèn LED RGB 4 bóng', 'actuator', 1, 'OhStem'),
('FAN_Mini', 'Quạt Mini DC', 'actuator', 1, 'OhStem'),
('DHT20', 'Cảm biến nhiệt độ độ ẩm DHT20', 'sensor', 1, 'Aosong'),
('LIGHT_SENSOR', 'Cảm biến ánh sáng ADC', 'sensor', 1, 'OhStem');
 
 -- 1. Thêm loại thiết bị DOOR_LOCK nếu chưa có
INSERT IGNORE INTO Device_Type (Type_Code, Type_Name, Type_Group, Supported, Manufacturer) 
VALUES ('DOOR_LOCK', 'Khóa cửa thông minh', 'security', 1, 'YoloHome');
 
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
                            
-- Guest: chỉ được mở cửa (PIN/Face tạm thời), không điều khiển thiết bị, không xem thông tin nhà
INSERT IGNORE INTO Role_Permission (Role_ID, Permission_ID)
SELECT r.Role_ID, p.Permission_ID FROM Role r CROSS JOIN Permission p
WHERE r.Role_Name = 'Guest' AND p.Permission_Code IN ('DOOR_UNLOCK');
