"""
YoloHome Gateway: cầu nối giữa mạch Yolo:Bit (cổng Serial/USB) và Adafruit IO (MQTT).

  Yolo:Bit --(Serial: !1:TEMP:28#)--> Gateway --(MQTT)--> Adafruit IO --> Backend
  Backend --(MQTT: device-light = "1")--> Adafruit IO --> Gateway --(Serial: !LIGHT:1#)--> Yolo:Bit

Định dạng chi tiết: xem PROTOCOL.md. Cấu hình: biến môi trường hoặc file .env (xem .env.example).
KHÔNG ghi khoá Adafruit vào mã nguồn.
"""
import os
import random
import ssl
import sys
import time
import unicodedata

import serial
import serial.tools.list_ports
from Adafruit_IO import MQTTClient

try:  # python-dotenv là tuỳ chọn: có thì đọc file .env cạnh main.py
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass


def env(name, default=None):
    value = os.environ.get(name, default)
    return value.strip() if isinstance(value, str) else value


AIO_USERNAME = env("ADAFRUIT_AIO_USERNAME")
AIO_KEY = env("ADAFRUIT_AIO_KEY")
AIO_HOST = env("ADAFRUIT_HOST", "io.adafruit.com")
AIO_SECURE = env("ADAFRUIT_SECURE", "1") != "0"   # 0 chỉ dùng khi thử với broker MQTT cục bộ (cổng 1883)
SERIAL_PORT = env("SERIAL_PORT")              # để trống -> tự dò cổng của Yolo:Bit
SERIAL_BAUD = int(env("SERIAL_BAUD", "115200"))
SIMULATE = env("SIMULATE", "0") == "1"        # 1 = gửi số liệu ngẫu nhiên (thử khi chưa có mạch)
SIMULATE_INTERVAL_S = 10

if not AIO_USERNAME or not AIO_KEY:
    sys.exit("Thiếu ADAFRUIT_AIO_USERNAME / ADAFRUIT_AIO_KEY. Tạo file Gateway/.env theo mẫu .env.example.")

# ---------- Feed ----------
# Lên (Yolo:Bit -> Adafruit): loại dữ liệu trong khung Serial -> feed
UPLINK_FEEDS = {
    "TEMP": "sensor-temperature",
    "HUMI": "sensor-humidity",
    "LIGHT": "sensor-light",
    "MOTION": "sensor-motion",
    "PIR": "sensor-motion",
    "DOOR": "door-status",
    "LOG": "hardware-log",
}
# Xuống (Adafruit -> Yolo:Bit): feed được nghe để chuyển lệnh xuống mạch
DOWNLINK_FEEDS = ["device-light", "device-fan", "smart-door", "hardware-log", "assistant"]


def ascii_text(text, limit=32):
    """LCD 16x2 không hiển thị được tiếng Việt có dấu, và '!' '#' là ký tự đóng khung -> loại bỏ."""
    text = unicodedata.normalize("NFD", str(text)).replace("đ", "d").replace("Đ", "D")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.encode("ascii", "ignore").decode()
    return text.replace("!", "").replace("#", "").replace(":", " ").strip()[:limit]


def to_serial_frame(feed_id, payload):
    """Đổi giá trị trên feed thành khung lệnh gửi xuống Yolo:Bit. Trả về None nếu không cần gửi."""
    value = str(payload).strip()
    if feed_id == "device-light":
        if value.startswith("#") and len(value) == 7:
            return f"!COLOR:{value[1:].upper()}#"          # bỏ '#' vì '#' là ký tự kết thúc khung
        return f"!LIGHT:{1 if value.upper() in ('1', 'ON', 'TRUE') else 0}#"
    if feed_id == "device-fan":
        try:
            speed = max(0, min(100, int(float(value))))
        except ValueError:
            return None
        return f"!FAN:{speed}#"
    if feed_id == "smart-door":
        return f"!DOOR:{1 if value.upper() in ('1', 'ON', 'OPEN', 'UNLOCK') else 0}#"
    if feed_id == "hardware-log":
        # Chỉ chuyển lệnh còi "BUZZER:1"; các dòng log khác (do chính mạch gửi lên) bỏ qua
        if value.upper().startswith("BUZZER:"):
            return f"!BUZZER:{1 if value.split(':', 1)[1].strip() == '1' else 0}#"
        return None
    if feed_id == "assistant":
        return f"!MSG:{ascii_text(value)}#"
    return None


# ---------- Serial ----------
ser = None
last_serial_try = 0


def find_port():
    for port in serial.tools.list_ports.comports():
        desc = f"{port.device} {port.description}"
        if "USB Serial" in desc or "micro:bit" in desc or "CH340" in desc or "CP210" in desc:
            return port.device
    return None


def ensure_serial():
    """Mở (lại) cổng Serial, thử lại mỗi 5 giây nếu mạch chưa cắm hoặc bị rút ra."""
    global ser, last_serial_try
    if ser is not None and ser.is_open:
        return True
    if time.time() - last_serial_try < 5:
        return False
    last_serial_try = time.time()
    port = SERIAL_PORT or find_port()
    if not port:
        print("Chưa thấy Yolo:Bit trên cổng Serial (đặt SERIAL_PORT trong .env nếu dò sai).")
        return False
    try:
        ser = serial.Serial(port=port, baudrate=SERIAL_BAUD, timeout=0)
        print(f"Đã kết nối Yolo:Bit ở cổng {port}")
        return True
    except (serial.SerialException, OSError) as e:
        print(f"Không mở được cổng {port}: {e}")
        ser = None
        return False


def write_serial(frame):
    global ser
    if not ensure_serial():
        print(f"(Chưa có Serial) bỏ qua lệnh {frame}")
        return
    try:
        ser.write(frame.encode("ascii"))
        print(f"-> Yolo:Bit {frame}")
    except (serial.SerialException, OSError) as e:
        print(f"Lỗi ghi Serial: {e}")
        ser = None


# ---------- MQTT ----------
def connected(client):
    print("Đã kết nối Adafruit IO")
    for feed in DOWNLINK_FEEDS:
        client.subscribe(feed)


def disconnected(client):
    # Không thoát chương trình: thư viện tự kết nối lại
    print("Mất kết nối Adafruit IO, đang thử kết nối lại...")


def message(client, feed_id, payload):
    print(f"<- {feed_id}: {payload}")
    frame = to_serial_frame(feed_id, payload)
    if frame:
        write_serial(frame)


def publish(feed, value):
    try:
        client.publish(feed, value)
        print(f"-> {feed}: {value}")
    except Exception as e:  # noqa: BLE001 - mất mạng tạm thời không được làm dừng gateway
        print(f"Không gửi được lên {feed}: {e}")


# ---------- Xử lý khung dữ liệu từ Yolo:Bit: !ID:TYPE:VALUE# ----------
def process_frame(frame):
    parts = frame.strip("!#").split(":")
    if len(parts) < 3:
        return
    data_type, value = parts[1].strip().upper(), ":".join(parts[2:]).strip()
    feed = UPLINK_FEEDS.get(data_type)
    if not feed:
        print(f"Bỏ qua loại dữ liệu không biết: {frame}")
        return
    if data_type != "LOG":
        try:
            float(value)
        except ValueError:
            print(f"Bỏ qua giá trị không phải số: {frame}")
            return
    publish(feed, value)


buffer = ""


def read_serial():
    global buffer, ser
    if not ensure_serial():
        return
    try:
        waiting = ser.in_waiting
        if waiting:
            buffer += ser.read(waiting).decode("utf-8", errors="ignore")
    except (serial.SerialException, OSError) as e:
        print(f"Mất kết nối Serial: {e}")
        ser = None
        return
    while "!" in buffer and "#" in buffer:
        start = buffer.find("!")
        end = buffer.find("#", start)
        if end == -1:
            buffer = buffer[start:]
            break
        process_frame(buffer[start:end + 1])
        buffer = buffer[end + 1:]
    if len(buffer) > 512:  # rác không có khung hợp lệ
        buffer = buffer[-64:]


# ---------- Khởi tạo MQTT Client & Xử lý SSL ----------
client = MQTTClient(AIO_USERNAME, AIO_KEY, service_host=AIO_HOST, secure=AIO_SECURE)
client.on_connect = connected
client.on_disconnect = disconnected
client.on_message = message

# Xử lý bỏ qua kiểm tra cert khi hệ thống thiếu CA Certificate Store
if AIO_SECURE:
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    client._client.tls_set_context(ssl_context)


def main():
    client.connect()
    client.loop_background()
    if SIMULATE:
        print(f"SIMULATE=1: gửi số liệu ngẫu nhiên mỗi {SIMULATE_INTERVAL_S}s (KHÔNG dùng khi đã cắm mạch thật)")
    last_sim = 0
    while True:
        if SIMULATE:
            if time.time() - last_sim >= SIMULATE_INTERVAL_S:
                publish("sensor-temperature", random.randint(25, 38))
                publish("sensor-humidity", random.randint(40, 90))
                publish("sensor-light", random.randint(50, 800))
                publish("sensor-motion", 1 if random.random() < 0.3 else 0)
                last_sim = time.time()
        else:
            read_serial()
        time.sleep(0.1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Dừng gateway")