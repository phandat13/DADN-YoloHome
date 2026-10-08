DROP DATABASE IF EXISTS smart_home;
CREATE DATABASE smart_home CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_home;

CREATE TABLE `User` (
	User_ID INT AUTO_INCREMENT PRIMARY KEY,
    `Name` VARCHAR(100) NOT NULL,
    Email VARCHAR(150) NOT NULL UNIQUE,
    `Password` VARCHAR(255) NOT NULL,       -- SAVE HASH
    Display_name VARCHAR(100),
    Account_state VARCHAR(30) NOT NULL DEFAULT 'Active',
    Time_account_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Home (
	Home_ID INT AUTO_INCREMENT PRIMARY KEY,
    Home_Name VARCHAR(100) NOT NULL,
    Address VARCHAR(255),
    `State` VARCHAR(30),
    Time_Home_Created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Owner_ID INT NOT NULL,
    CONSTRAINT fk_home_owner FOREIGN KEY (Owner_ID)
		REFERENCES `User`(User_ID) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE Home_Updated_Time (
	Home_ID INT NOT NULL,
    Updated_Time DATETIME NOT NULL,
    PRIMARY KEY (Home_ID, Updated_Time),
    CONSTRAINT fk_hut_home FOREIGN KEY (Home_ID)
		REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `Role` (
	Role_ID INT AUTO_INCREMENT PRIMARY KEY,
    Role_Name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Permission (
	Permission_ID INT AUTO_INCREMENT PRIMARY KEY,
    Permission_Code VARCHAR(50) NOT NULL UNIQUE,
    Permission_Name VARCHAR(100) NOT NULL,
    Permission_Module VARCHAR(50),
    Permission_Description VARCHAR(255)
);

CREATE TABLE Role_Permission (
    Role_ID INT NOT NULL,
    Permission_ID INT NOT NULL,
    PRIMARY KEY (Role_ID, Permission_ID),
    CONSTRAINT fk_rp_role FOREIGN KEY (Role_ID)
        REFERENCES Role(Role_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_rp_permission FOREIGN KEY (Permission_ID)
        REFERENCES Permission(Permission_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Home_Member (
    Home_Member_ID INT AUTO_INCREMENT PRIMARY KEY,
    `Status` VARCHAR(30) NOT NULL DEFAULT 'active',
    Joined DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Expired DATETIME NULL,
    User_ID INT NOT NULL,
    Home_ID INT NOT NULL,
    Role_ID INT NOT NULL,
    UNIQUE KEY uq_member (User_ID, Home_ID),
    CONSTRAINT fk_hm_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_hm_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_hm_role FOREIGN KEY (Role_ID)
        REFERENCES Role(Role_ID) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE Notification (
    Notification_ID INT AUTO_INCREMENT PRIMARY KEY,
    Title VARCHAR(150) NOT NULL,
    `Type` VARCHAR(50),
    Content TEXT,
    `Level` VARCHAR(30),
    Unread_Read ENUM('Unread','Read') NOT NULL DEFAULT 'Unread',
    User_ID INT NOT NULL,
    CONSTRAINT fk_noti_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Activity_Log (
    Activity_Log_ID INT AUTO_INCREMENT PRIMARY KEY,
    Entity_Type VARCHAR(50),
    `Action` VARCHAR(100),
    `Source` VARCHAR(50),
    `Result` VARCHAR(50),
    `Time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    User_ID INT NOT NULL,
    Home_ID INT NOT NULL,
    CONSTRAINT fk_al_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_al_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Smart_Door (
	Smart_Door_ID INT AUTO_INCREMENT PRIMARY KEY,
    Smart_Door_Name VARCHAR(100),
    Working_State VARCHAR(30) NOT NULL DEFAULT 'enabled',
    Lock_Unlock_State ENUM('Locked','Unlocked') NOT NULL DEFAULT 'Locked',
    Home_ID INT NOT NULL,
    UNIQUE KEY `idx_home_door_unique` (`Home_ID`, `Smart_Door_Name`),
	INDEX `idx_door_name` (`Smart_Door_Name`),
    CONSTRAINT fk_door_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Face_Profile (
    Face_Profile_ID INT AUTO_INCREMENT PRIMARY KEY,
    Face_Name VARCHAR(100) NULL COMMENT 'Tên nhận dạng khuôn mặt',
    Face_Data JSON NULL COMMENT 'Vector 128D/512D khuôn mặt',
    Valid_From DATETIME NULL,
    Valid_To DATETIME NULL,
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    User_ID INT NOT NULL,
    Home_ID INT NOT NULL,
    CONSTRAINT fk_fp_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_fp_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_user_home UNIQUE (User_ID, Home_ID)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE Face_Recognition_Event (
    FaceRegEvent_ID INT AUTO_INCREMENT PRIMARY KEY,
    Reliability DECIMAL(5,2),
    Label VARCHAR(100),
    Recognization_Result VARCHAR(50),
    `Time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Face_Profile_ID INT NULL,                        -- có thể là người lạ
    Smart_Door_Name VARCHAR(100) NOT NULL,
    Home_ID INT NOT NULL,
    CONSTRAINT fk_fre_profile FOREIGN KEY (Face_Profile_ID)
        REFERENCES Face_Profile(Face_Profile_ID) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fre_door FOREIGN KEY (Smart_Door_Name)
        REFERENCES Smart_Door(Smart_Door_Name) ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT fk_fre_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Access_Credential (
    Credential_ID INT AUTO_INCREMENT PRIMARY KEY,
    Credential_Value VARCHAR(255) NOT NULL,
    Credential_State VARCHAR(30)  NOT NULL DEFAULT 'active',
    Valid_From DATETIME,
    Valid_To DATETIME,
    User_ID INT NOT NULL,
    Smart_Door_Name VARCHAR(100) NOT NULL,
    CONSTRAINT fk_ac_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ac_door FOREIGN KEY (Smart_Door_Name)
        REFERENCES Smart_Door(Smart_Door_Name) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Access_Attempt (
    Access_ID INT AUTO_INCREMENT PRIMARY KEY,
    Verify_Method VARCHAR(50),
    Access_Result VARCHAR(30),
    `Time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Failure_Reason VARCHAR(255),
    User_ID INT NULL,
    Smart_Door_Name VARCHAR(100) NOT NULL,
    CONSTRAINT fk_aa_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_aa_door FOREIGN KEY (Smart_Door_Name)
        REFERENCES Smart_Door(Smart_Door_Name) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Device_Type (
    Type_Code VARCHAR(50) PRIMARY KEY,
    Type_Name VARCHAR(100) NOT NULL,
    Type_Group VARCHAR(50),
    `Description` VARCHAR(255),
    Supported BOOLEAN NOT NULL DEFAULT TRUE,
    Manufacturer VARCHAR(100)
);

CREATE TABLE Yolo_Controller (
    Controller_ID INT AUTO_INCREMENT PRIMARY KEY,
    Controller_Name VARCHAR(100) NOT NULL,
    Lastest_working_time DATETIME,
    Connection_State VARCHAR(30),
    Firmware_version VARCHAR(30)
);

CREATE TABLE Device (
    Device_ID INT AUTO_INCREMENT PRIMARY KEY,
    Device_Name VARCHAR(100) NOT NULL,
    Hardware_ID VARCHAR(100) UNIQUE,
    Serial_No VARCHAR(100),
    Connection_State ENUM('online', 'offline') NOT NULL DEFAULT 'online',
    Last_Connection_Time DATETIME,
    Available_working_State VARCHAR(50) NOT NULL DEFAULT 'off',
    Home_ID INT NOT NULL,
    Type_Code VARCHAR(50) NOT NULL,
    Feed_Key VARCHAR(100) NULL,
    Controller_ID INT NULL,
    CONSTRAINT fk_dev_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dev_type FOREIGN KEY (Type_Code)
        REFERENCES Device_Type(Type_Code) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_dev_ctrl FOREIGN KEY (Controller_ID)
        REFERENCES Yolo_Controller(Controller_ID) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE Device_State (
    Device_State_ID INT AUTO_INCREMENT PRIMARY KEY,
    Current_State VARCHAR(50) NOT NULL,
    Changed_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Device_ID INT NOT NULL,
    CONSTRAINT fk_ds_dev FOREIGN KEY (Device_ID)
        REFERENCES Device(Device_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Device_Command (
    Command_ID INT AUTO_INCREMENT PRIMARY KEY,
    Source_ID INT,
    Source_Type ENUM('USER','VOICE_COMMAND','SCHEDULE','SYSTEM') NOT NULL,
    Data_attached JSON,
    Excute_Time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Excute_State ENUM('PENDING', 'SUCCESS', 'FAILED', 'EXECUTED') NOT NULL DEFAULT 'PENDING',
    Device_ID INT NOT NULL,
    CONSTRAINT fk_dc_dev FOREIGN KEY (Device_ID)
        REFERENCES Device(Device_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Voice_Command (
    Voice_Command_ID INT AUTO_INCREMENT PRIMARY KEY,
    Command_Detail VARCHAR(255),
    Device INT NULL,                        
    Command_Data JSON,
    Working_State VARCHAR(30),
    `Language` VARCHAR(20),
    User_ID INT NOT NULL,
    Home_ID INT NOT NULL,
    CONSTRAINT fk_vc_user FOREIGN KEY (User_ID)
        REFERENCES `User`(User_ID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_vc_home FOREIGN KEY (Home_ID)
        REFERENCES Home(Home_ID) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE Sensor (
    `Sensor_ID` INT AUTO_INCREMENT PRIMARY KEY,
    `Sensor_Name` VARCHAR(100) NOT NULL,
    `Sensor_Type` VARCHAR(50) NOT NULL DEFAULT 'TEMPERATURE',
    `Data_Type` VARCHAR(30) NULL DEFAULT 'FLOAT',
    `Current_Value` DOUBLE NULL DEFAULT 0,
    `Sampling_Cycle` INT COMMENT 'giây',
    `Working_State` VARCHAR(30) DEFAULT 'enabled',
    `Unit` VARCHAR(20) NOT NULL DEFAULT '',
    `Feed_Key` VARCHAR(100) NULL,
    `Last_Updated` DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `Device_ID` INT NOT NULL,
    CONSTRAINT `fk_sensor_dev` FOREIGN KEY (`Device_ID`)
        REFERENCES `Device`(`Device_ID`) ON DELETE CASCADE ON UPDATE CASCADE
);
 
CREATE TABLE Sensor_Record (
  Record_ID INT AUTO_INCREMENT PRIMARY KEY,
  Sensor_ID INT NOT NULL,
  Sensor_Value DOUBLE NOT NULL,
  Data_Quality ENUM('good', 'bad', 'uncertain') NOT NULL DEFAULT 'good',
  Time_Stamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sensor_time (`Sensor_ID`, `Time_Stamp`),
  CONSTRAINT `fk_record_sensor` FOREIGN KEY (`Sensor_ID`) REFERENCES `Sensor` (`Sensor_ID`) ON DELETE CASCADE
);

CREATE TABLE System_Event (
    Event_ID INT AUTO_INCREMENT PRIMARY KEY,
    Connection_State VARCHAR(30),
    Description VARCHAR(255),
    Server_State VARCHAR(30),
    `Time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_access_time ON Access_Attempt(`Time`);
CREATE INDEX idx_fre_time ON Face_Recognition_Event(`Time`);
CREATE INDEX idx_device_home ON Device(Home_ID);
CREATE INDEX idx_device_state ON Device_State(Device_ID, Changed_At);
CREATE INDEX idx_hm_home ON Home_Member(Home_ID);
CREATE INDEX idx_notification_unread ON Notification(User_ID, Unread_Read);
CREATE INDEX idx_device_command_history ON Device_Command(Device_ID, Excute_Time);
CREATE INDEX idx_access_credential ON Access_Credential(Smart_Door_Name, Credential_State);