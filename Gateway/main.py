import random
import sys
import time
import serial
import serial.tools.list_ports
from Adafruit_IO import MQTTClient

# Cấu hình tài khoản Adafruit IO
ADAFRUIT_AIO_USERNAME = "phandat13"
ADAFRUIT_AIO_KEY = "aio_QRRI79CTPemWpRatb3NCR9Fd3XCb"

FEED_TEMP = "sensor-temperature"

# MQTT Callbacks
def connected(client):
    print("Connected to Adafruit IO!")
    client.subscribe(FEED_TEMP)
    print("Subscribed to:", FEED_TEMP)

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

# Xử lý chuỗi dữ liệu nhận được dạng !ID:TEMP:VALUE#
def processData(data):
    data = data.replace("!", "").replace("#", "")
    splitData = data.split(":")
    print("Parsed Data:", splitData)
    if len(splitData) >= 3 and splitData[1] == "TEMP":
        client.publish(FEED_TEMP, splitData[2])

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
    # 1. Đọc dữ liệu từ Serial liên tục
    readSerial()

    # 2. Gửi dữ liệu định kỳ mỗi 30 giây (không dùng time.sleep dài để tránh block serial)
    if time.time() - last_publish >= 30:
        value = random.randint(0, 100)
        print("Cap nhat ngau nhien:", value)
        client.publish(FEED_TEMP, value)
        last_publish = time.time()

    time.sleep(0.1)