SET NAMES utf8mb4;
USE smart_home;

SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS evt_expire_members;
CREATE EVENT IF NOT EXISTS evt_expire_members
    ON SCHEDULE EVERY 5 MINUTE DO CALL sp_expire_members();

DROP EVENT IF EXISTS evt_check_offline_devices;
CREATE EVENT IF NOT EXISTS evt_check_offline_devices
    ON SCHEDULE EVERY 1 MINUTE DO CALL sp_check_offline_devices(5);

