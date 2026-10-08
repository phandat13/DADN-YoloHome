import random
import sys
import time
import serial
import serial.tools.list_ports
from Adafruit_IO import MQTTClient

# Cấu hình tài khoản Adafruit IO
ADAFRUIT_AIO_USERNAME = "phandat13"
ADAFRUIT_AIO_KEY = "aio_QRRI79CTPemWpRatb3NCR9Fd3XCb"

# Danh sách Feed
FEED_TEMP = "sensor-temperature"
FEED_HUMI = "sensor-humidity"
FEED_LIGHT = "sensor-light"

# MQTT Callbacks
def connected(client):
    print("Connected to Adafruit IO!")
    client.subscribe(FEED_TEMP)
    client.subscribe(FEED_HUMI)
    client.subscribe(FEED_LIGHT)
    print("Subscribed to feeds:", FEED_TEMP, FEED_HUMI, FEED_LIGHT)

def subscribe(client, userdata, mid, granted_qos):
    print("Subscribed successfully!")

def disconnect(client):
    print("Disconnected from Adafruit IO!")
    sys.exit(1)

def message(client, feed_id, payload):
    print(f"Message received on {feed_id}: {payload}")

# Khởi tạo kết nối MQTT Client
client = MQTTClient(ADAFRUIT_AIO_USERNAME, ADAFRUIT_AIO_KEY)
client.on_connect = connected
client.on_disconnect = disconnect
client.on_message = message
client.on_subscribe = subscribe
client.connect()
client.loop_background()

# Tìm cổng Serial
def getPort():
    ports = serial.tools.list_ports.comports()
    for port in ports:
        strPort = str(port)
        if "USB Serial Device" in strPort or "micro:bit" in strPort:
            return strPort.split(" ")[0]
    return "None"

port_name = getPort()
isMicrobitConnected = False
ser = None

if port_name != "None":
    try:
        ser = serial.Serial(port=port_name, baudrate=115200)
        isMicrobitConnected = True
        print(f"Connected to Microbit on port: {port_name}")
    except Exception as e:
        print(f"Failed to open serial port: {e}")
else:
    print("No compatible serial device found.")

# Xử lý chuỗi dữ liệu nhận được từ Serial: !ID:TYPE:VALUE#
# Ví dụ: !1:TEMP:28#, !1:HUMI:75#, !1:LIGHT:300#
def processData(data):
    data = data.replace("!", "").replace("#", "")
    splitData = data.split(":")
    print("Parsed Data:", splitData)
    if len(splitData) >= 3:
        sensor_type = splitData[1]
        sensor_val = splitData[2]

        if sensor_type == "TEMP":
            client.publish(FEED_TEMP, sensor_val)
        elif sensor_type == "HUMI":
            client.publish(FEED_HUMI, sensor_val)
        elif sensor_type == "LIGHT":
            client.publish(FEED_LIGHT, sensor_val)

mess = ""
def readSerial():
    global mess
    if isMicrobitConnected and ser and ser.inWaiting() > 0:
        try:
            mess += ser.read(ser.inWaiting()).decode("UTF-8", errors="ignore")
            while "#" in mess and "!" in mess:
                start = mess.find("!")
                end = mess.find("#")
                if start < end:
                    processData(mess[start : end + 1])
                    mess = mess[end + 1 :]
                else:
                    mess = mess[start:]
        except Exception as e:
            print(f"Error reading serial: {e}")

# Vòng lặp chính
last_publish = 0
while True:
    # 1. Đọc dữ liệu từ Serial Microbit liên tục
    readSerial()

    # 2. Gửi dữ liệu mẫu ngẫu nhiên định kỳ mỗi 5 giây
    if time.time() - last_publish >= 10:
        temp_val = random.randint(20, 40)       # Nhiệt độ: 20 - 40 °C
        humi_val = random.randint(40, 90)       # Độ ẩm: 40 - 90 %
        light_val = random.randint(100, 1000)   # Ánh sáng: 100 - 1000 lux

        print(f"Cap nhat ngau nhien -> Temp: {temp_val}, Humi: {humi_val}, Light: {light_val}")
        
        client.publish(FEED_TEMP, temp_val)
        client.publish(FEED_HUMI, humi_val)
        client.publish(FEED_LIGHT, light_val)

        last_publish = time.time()

    time.sleep(0.1)