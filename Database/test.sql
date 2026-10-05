use smart_home;

-- Kiểm tra xem User_ID = 2 đã tồn tại trong bảng User chưa
SELECT User_ID, Name, Email FROM `User` WHERE User_ID = 2;

-- Thêm User 2 làm thành viên (Member) của Home 1 (nếu chưa có)
INSERT INTO Home_Member (Home_ID, User_ID, Role_Code) 
VALUES (1, 2, 'MEMBER');