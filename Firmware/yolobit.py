# =============================================================================
#  YoloHome - Firmware cho Yolo:Bit (MicroPython, chạy ĐA LUỒNG bằng _thread)
#
#  Mạch tự kết nối WiFi và nói chuyện TRỰC TIẾP với Adafruit IO qua MQTT (không cần Gateway):
#    Mạch -> Adafruit : sensor-temperature, sensor-humidity, sensor-light, sensor-motion,
#                       door-status, hardware-log
#    Adafruit -> Mạch : device-light ("1"/"0"/"#RRGGBB"), device-fan (0..100), smart-door ("1"/"0"),
#                       hardware-log ("BUZZER:1"/"BUZZER:0"), assistant (câu hiện lên LCD)
#  Backend (Node.js) nghe/gửi trên đúng các feed này nên không phải sửa gì phía BE.
#
#  Chạy 2 LUỒNG song song (Yolo:Bit chỉ còn đủ RAM trong cho 1 luồng phụ khi bật WiFi + SSL):
#    LUỒNG CHÍNH  = mạng (mqtt bên dưới). Mạng chậm/mất KHÔNG làm đơ thiết bị.
#    LUỒNG THIẾT BỊ = tự lên lịch các việc còn lại, mỗi việc một chu kì riêng.
#    [mqtt]    WiFi + MQTT: nhận lệnh -> điều khiển đèn RGB, quạt, chuyển lệnh cửa/còi/LCD;
#              gửi dữ liệu trong hàng đợi lên Adafruit (giãn cách để không vượt 30 điểm/phút)
#    [sensor]  đọc DHT20 + ánh sáng mỗi 20 giây
#    [lcd]     vẽ lại màn hình LCD 16x2 mỗi 0.5 giây
#    [io]      mỗi 0.1 giây: đọc PIR (chỉ gửi khi đổi) + remote hồng ngoại / servo cửa
#    [sound]   còi/âm báo
#
#  Nguyên tắc chống xung đột giữa các luồng:
#    - Mỗi thiết bị chỉ do MỘT luồng điều khiển (đèn+quạt: mqtt, servo: door, loa: main).
#    - Kết nối MQTT chỉ luồng mqtt được dùng (umqtt không an toàn đa luồng). Luồng khác
#      gọi send() -> chỉ bỏ vào hàng đợi outbox.
#    - DHT20 và LCD dùng chung bus I2C (chân P19/P20) -> phải giữ khoá i2c_lock.
#
#  Cách nạp: xem README.md đi kèm.
#  Muốn nạp lại chương trình mà mạch đang chạy: GIỮ NÚT B rồi bấm reset (hoặc rút/cắm
#  lại USB) -> mạch vào chế độ an toàn, không chạy các luồng.
#  (Không dùng nút A: giữ A + Reset là thao tác KHÔI PHỤC CÀI ĐẶT GỐC của Yolo:Bit.)
# =============================================================================

import sys
import gc
import _thread
import time

import network
import machine
from machine import Pin, PWM
from yolobit import *            # pin0..pin20, button_a, ...
from aiot_rgbled import RGBLed
from aiot_dht20 import DHT20
from aiot_lcd1602 import LCD1602
from aiot_ir_receiver import *   # IR_RX, IR_REMOTE_0..9, IR_REMOTE_A..F

try:
    import music                 # loa có sẵn trên Yolo:Bit
except ImportError:
    music = None

try:
    from umqtt_simple import MQTTClient      # có sẵn khi thêm mở rộng MQTT trong app OhStem
except ImportError:
    from umqtt.simple import MQTTClient      # bản có sẵn trong firmware MicroPython ESP32

# ---- ĐIỀN THÔNG TIN WIFI + ADAFRUIT VÀO 4 DÒNG DƯỚI (khi nạp bằng app OhStem) ----
# ĐỪNG commit bản đã điền key lên GitHub. Ai dùng Thonny có thể để 4 biến này
# trong file riêng yolo_secret.py trên mạch, file đó sẽ được ưu tiên.
WIFI_SSID = "DD04122005"                       # chỉ WiFi 2.4 GHz
WIFI_PASS = "04122005"
AIO_USERNAME = ""      # phân biệt hoa/thường
AIO_KEY = ""
try:
    from yolo_secret import WIFI_SSID, WIFI_PASS, AIO_USERNAME, AIO_KEY
except ImportError:
    pass

# ----------------------------- CẤU HÌNH --------------------------------------
AIO_HOST = "io.adafruit.com"
AIO_SSL = True                   # True = cổng 8883 có mã hoá (nhiều WiFi chặn 1883). Lỗi RAM -> giảm THREAD_STACK
PUBLISH_GAP_MS = 2100            # >= 2 giây/lần gửi -> không bao giờ vượt 30 điểm/phút
SYNC_ON_CONNECT = True           # kết nối xong thì hỏi lại trạng thái đèn/quạt đang lưu trên Adafruit

# Loại dữ liệu -> feed Adafruit (giống Gateway cũ)
UPLINK_FEEDS = {
    "TEMP": "sensor-temperature",
    "HUMI": "sensor-humidity",
    "LIGHT": "sensor-light",
    "MOTION": "sensor-motion",
    "DOOR": "door-status",
    "LOG": "hardware-log",
}
DOWNLINK_FEEDS = ("device-light", "device-fan", "smart-door", "hardware-log", "assistant")

# Chân cắm theo Bảng 25.1 giáo trình (quạt không có trong bảng -> dùng P10 như Chương 7)
RGB_PIN, RGB_COUNT = pin0, 4
IR_PIN = pin1
LIGHT_PIN = pin2                 # chỉ P0/P1/P2 đọc được analog
PIR_PIN = pin3
SERVO_PIN = pin4
FAN_PIN = pin10

SENSOR_PERIOD_MS = 20000         # Adafruit miễn phí: 30 điểm/phút cho TẤT CẢ feed
LIGHT_SCALE_MAX = 1000           # đổi 0..4095 -> 0..1000 (Light_Min mặc định của Backend = 200)
LIGHT_INVERT = False             # True nếu cảm biến của bạn càng sáng giá trị càng NHỎ

DOOR_CLOSED_ANGLE = 0
DOOR_OPEN_ANGLE = 90
DOOR_AUTO_LOCK_MS = 15000        # mở bằng remote: tự khoá sau 15s (0 = không tự khoá)
DEFAULT_PASS = "1234"
PASS_FILE = "door_pass.txt"
MAX_WRONG = 3                    # sai 3 lần -> hú còi 5 giây
PASS_TIMEOUT_MS = 15000          # đang nhập dở mà bỏ đi 15s -> xoá

LCD_MSG_MS = 8000                # câu của trợ lý (!MSG) hiện trong 8 giây
THREAD_STACK = 8 * 1024          # stack luồng thiết bị (lấy từ RAM trong của ESP32, rất ít)

# ----------------------------- TIỆN ÍCH THỜI GIAN ----------------------------
try:
    ticks_ms, ticks_diff, sleep_ms = time.ticks_ms, time.ticks_diff, time.sleep_ms
except AttributeError:           # chỉ để chạy thử trên máy tính
    ticks_ms = lambda: int(time.time() * 1000)
    ticks_diff = lambda a, b: a - b
    sleep_ms = lambda ms: time.sleep(ms / 1000)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def hex_rgb(text):
    text = text.strip().lstrip("#")
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


# ----------------------------- TRẠNG THÁI DÙNG CHUNG -------------------------
class State:
    running = True

    temp = None
    humi = None
    light = None
    motion = 0

    light_on = False
    color = (255, 255, 255)
    fan = 0
    door_open = False

    buzzer_on = False            # còi bật từ server (!BUZZER:1#)
    alarm_until = 0              # còi cục bộ (nhập sai mật mã) đến thời điểm này
    beep_queue = []              # các âm báo ngắn do luồng khác yêu cầu

    door_request = None          # (mở?: bool, nguồn: str) do luồng rx đặt, luồng door xử lý

    net = "wifi"                 # "wifi" -> "mqtt" -> "ok": trạng thái mạng, hiện trên LCD

    msg = ""                     # câu trợ lý / thông báo cục bộ trên LCD dòng 2
    msg_until = 0
    pass_display = None          # đang nhập mật mã -> hiện "***" trên LCD


S = State()
state_lock = _thread.allocate_lock()
tx_lock = _thread.allocate_lock()
i2c_lock = _thread.allocate_lock()


def show_msg(text, ms=LCD_MSG_MS):
    with state_lock:
        S.msg = text
        S.msg_until = ticks_ms() + ms


def beep(notes):
    """Yêu cầu luồng chính phát một âm báo ngắn, ví dụ beep(['C5:1'])."""
    with state_lock:
        if len(S.beep_queue) < 5:
            S.beep_queue.append(notes)


# ----------------------------- HÀNG ĐỢI GỬI LÊN ADAFRUIT --------------------
# Luồng nào cũng gọi send(); chỉ luồng mqtt lấy ra gửi đi.
# Cảm biến/cửa: nếu giá trị cũ của cùng feed chưa kịp gửi thì GHI ĐÈ (chỉ cần giá trị mới nhất).
# LOG: xếp hàng, tối đa 6 dòng.
outbox = []                      # [(feed, value)]
out_lock = _thread.allocate_lock()


def clean(text):
    return str(text).replace("\r", " ").replace("\n", " ")


def send(kind, value):
    feed = UPLINK_FEEDS[kind]
    value = clean(value)
    with out_lock:
        if kind != "LOG":
            for i in range(len(outbox)):
                if outbox[i][0] == feed:
                    outbox[i] = (feed, value)
                    return
        else:
            logs = [i for i in range(len(outbox)) if outbox[i][0] == feed]
            if len(logs) >= 6:
                outbox.pop(logs[0])
        outbox.append((feed, value))


def debug(text):
    """In ra cổng USB để xem bằng Serial monitor / Thonny (không gửi lên Adafruit)."""
    with tx_lock:
        print("[yolohome] " + clean(text))


# Bỏ dấu tiếng Việt: LCD 16x2 chỉ hiện được ASCII
_VN = {
    "a": "àáạảãâầấậẩẫăằắặẳẵ", "e": "èéẹẻẽêềếệểễ", "i": "ìíịỉĩ",
    "o": "òóọỏõôồốộổỗơờớợởỡ", "u": "ùúụủũưừứựửữ", "y": "ỳýỵỷỹ", "d": "đ",
}
_VN_MAP = {}
for _base, _chars in _VN.items():
    for _c in _chars:
        _VN_MAP[_c] = _base
        _VN_MAP[_c.upper()] = _base.upper()


def to_ascii(text):
    out = []
    for c in text:
        c = _VN_MAP.get(c, c)
        if 32 <= ord(c) < 127:
            out.append(c)
    return "".join(out).strip()


# ----------------------------- KHỞI TẠO THIẾT BỊ -----------------------------
def try_init(name, factory):
    try:
        with i2c_lock:
            return factory()
    except Exception as e:
        debug("Khong khoi tao duoc %s: %s" % (name, e))
        return None


rgb = RGBLed(RGB_PIN.pin, RGB_COUNT)
dht = try_init("DHT20", DHT20)
lcd = try_init("LCD", LCD1602)
servo = PWM(Pin(SERVO_PIN.pin), freq=50)
ir = IR_RX(Pin(IR_PIN.pin, Pin.IN))
ir.start()

IR_DIGITS = {
    IR_REMOTE_0: "0", IR_REMOTE_1: "1", IR_REMOTE_2: "2", IR_REMOTE_3: "3", IR_REMOTE_4: "4",
    IR_REMOTE_5: "5", IR_REMOTE_6: "6", IR_REMOTE_7: "7", IR_REMOTE_8: "8", IR_REMOTE_9: "9",
}


# ----------------------------- ĐIỀU KHIỂN THIẾT BỊ ---------------------------
def apply_light():
    rgb.show(0, S.color if S.light_on else (0, 0, 0))


def set_fan(percent):
    S.fan = clamp(percent, 0, 100)
    FAN_PIN.write_analog(round(S.fan * 1023 / 100))


def servo_angle(angle):
    # duty 10 bit ~25..115 tương ứng 0..180 độ (giống thư viện OhStem)
    servo.duty(25 + int(clamp(angle, 0, 180) * 90 / 180))


# ----------------------------- BỘ CHẠY LUỒNG ---------------------------------
def start_worker(name, step, period_ms, stack=None):
    """Chạy step() lặp lại mỗi period_ms trong một luồng riêng. Lỗi không làm chết luồng."""
    def loop():
        debug("Luong %s bat dau" % name)
        while S.running:
            t0 = ticks_ms()
            try:
                step()
            except Exception as e:
                debug("Loi luong %s: %s" % (name, e))
                sleep_ms(500)
            # ngủ từng đoạn ngắn để khi dừng firmware luồng thoát ngay, không phải chờ hết chu kì
            while S.running:
                wait = period_ms - ticks_diff(ticks_ms(), t0)
                if wait <= 0:
                    break
                sleep_ms(wait if wait < 100 else 100)
        debug("Luong %s dung" % name)
    try:
        _thread.stack_size(stack or THREAD_STACK)
    except Exception:
        pass
    gc.collect()
    try:
        _thread.start_new_thread(loop, ())
    except Exception as e:
        debug("KHONG TAO DUOC LUONG %s: %s (thieu RAM? giam THREAD_STACK/MQTT_STACK)" % (name, e))


# ===================== LUỒNG 1: WIFI + MQTT (ADAFRUIT IO) ====================
def handle_feed(feed, value):
    """Đổi giá trị trên feed thành hành động trên mạch (trước đây Gateway làm việc này)."""
    value = value.strip()
    up = value.upper()
    if feed == "device-light":
        if value.startswith("#") and len(value) == 7:           # color picker: "#FF0000"
            S.color = hex_rgb(value)
            S.light_on = True
        else:
            S.light_on = up in ("1", "ON", "TRUE")
        apply_light()
    elif feed == "device-fan":
        set_fan(int(float(value)))
    elif feed == "smart-door":
        with state_lock:
            S.door_request = (up in ("1", "ON", "OPEN", "UNLOCK"), "server")
    elif feed == "hardware-log":
        # feed này mạch cũng tự gửi LOG lên -> chỉ xử lý lệnh còi, bỏ qua các dòng khác
        if up.startswith("BUZZER:"):
            S.buzzer_on = up.split(":", 1)[1].strip() == "1"
    elif feed == "assistant":
        show_msg(to_ascii(value))


_net = {
    "wlan": network.WLAN(network.STA_IF),
    "client": None,
    "prefix": AIO_USERNAME + "/feeds/",
    "last_pub": 0,
    "last_ping": 0,
    "pause_until": 0,
}


def on_message(topic, msg):
    topic = topic.decode()
    try:
        value = msg.decode("utf-8")
    except Exception:
        value = msg.decode("ascii", "ignore") if hasattr(msg, "decode") else str(msg)
    if topic.startswith(_net["prefix"]):
        feed = topic[len(_net["prefix"]):]
        try:
            handle_feed(feed, value)
        except Exception as e:
            debug("Lenh loi %s=%s: %s" % (feed, value, e))
    elif topic.endswith("/throttle"):
        # Adafruit báo đang vượt giới hạn -> ngừng gửi 30 giây
        _net["pause_until"] = ticks_ms() + 30000
        debug("Adafruit throttle: " + value)
    elif topic.endswith("/errors"):
        debug("Adafruit error: " + value)


def wifi_connect():
    wlan = _net["wlan"]
    S.net = "wifi"
    wlan.active(True)
    if wlan.isconnected():
        return True
    debug("Ket noi WiFi " + WIFI_SSID)
    try:
        wlan.connect(WIFI_SSID, WIFI_PASS)
    except OSError:
        pass                                     # đang trong quá trình kết nối
    t0 = ticks_ms()
    while S.running and not wlan.isconnected() and ticks_diff(ticks_ms(), t0) < 15000:
        sleep_ms(200)
    if wlan.isconnected():
        debug("WiFi OK, IP " + wlan.ifconfig()[0])
        return True
    debug("Khong ket noi duoc WiFi, thu lai sau")
    return False


_DNS_SERVERS = ("8.8.8.8", "1.1.1.1")
_dns_try = [0]


def resolve_host():
    """Tra địa chỉ Adafruit. Lỗi -202 = DNS của WiFi không trả lời -> đổi sang DNS công cộng."""
    import socket
    for _ in range(3):
        try:
            if socket.getaddrinfo(AIO_HOST, 1883):
                return True
        except OSError as e:
            debug("DNS loi (%s) khi tra %s" % (e, AIO_HOST))
        sleep_ms(500)
    wlan = _net["wlan"]
    ip, mask, gw, dns = wlan.ifconfig()
    new_dns = _DNS_SERVERS[_dns_try[0] % len(_DNS_SERVERS)]
    _dns_try[0] += 1
    debug("Doi DNS %s -> %s" % (dns, new_dns))
    wlan.ifconfig((ip, mask, gw, new_dns))
    return False


def mqtt_connect():
    S.net = "mqtt"
    if not resolve_host():
        raise OSError(-202)
    client_id = "yolohome-" + "".join("%02x" % b for b in machine.unique_id())
    c = MQTTClient(client_id, AIO_HOST, port=8883 if AIO_SSL else 1883,
                   user=AIO_USERNAME, password=AIO_KEY, keepalive=60, ssl=AIO_SSL,
                   ssl_params={"server_hostname": AIO_HOST} if AIO_SSL else {})
    c.set_callback(on_message)
    c.connect()
    for feed in DOWNLINK_FEEDS:
        c.subscribe((_net["prefix"] + feed).encode())
    c.subscribe((AIO_USERNAME + "/throttle").encode())
    c.subscribe((AIO_USERNAME + "/errors").encode())
    if SYNC_ON_CONNECT:                          # Adafruit gửi lại giá trị cuối của feed
        for feed in ("device-light", "device-fan"):
            c.publish((_net["prefix"] + feed + "/get").encode(), b"")
    _net["client"] = c
    _net["last_ping"] = _net["last_pub"] = ticks_ms()
    S.net = "ok"
    debug("Da ket noi Adafruit IO")


def mqtt_close():
    c, _net["client"] = _net["client"], None
    if c is not None:
        try:
            c.disconnect()
        except Exception:
            pass


def mqtt_step():
    try:
        if not _net["wlan"].isconnected():
            mqtt_close()
            if not wifi_connect():
                sleep_ms(3000)
                return
        if _net["client"] is None:
            mqtt_connect()
        c = _net["client"]

        # 1) nhận hết tin nhắn đang chờ (không chặn)
        for _ in range(10):
            if c.check_msg() is None:
                break

        now = ticks_ms()
        # 2) gửi 1 mục trong hàng đợi, giãn cách PUBLISH_GAP_MS
        if ticks_diff(now, _net["last_pub"]) >= PUBLISH_GAP_MS and ticks_diff(now, _net["pause_until"]) >= 0:
            with out_lock:
                item = outbox.pop(0) if outbox else None
            if item is not None:
                try:
                    c.publish((_net["prefix"] + item[0]).encode(), item[1].encode())
                except Exception:
                    with out_lock:
                        outbox.insert(0, item)          # gửi lỗi -> trả lại hàng đợi
                    raise
                _net["last_pub"] = _net["last_ping"] = now

        # 3) giữ kết nối sống (keepalive 60s)
        if ticks_diff(now, _net["last_ping"]) > 30000:
            c.ping()
            _net["last_ping"] = now
    except Exception as e:
        code = e.args[0] if getattr(e, "args", None) else e
        hint = {-202: " (loi DNS: WiFi khong tra duoc io.adafruit.com)",
                5: " (sai AIO_USERNAME hoac AIO_KEY)", 4: " (sai AIO_USERNAME hoac AIO_KEY)",
                104: " (bi ngat ket noi)", 113: " (WiFi chan cong 1883?)"}.get(code, "")
        debug("Mat ket noi MQTT: %s%s" % (e, hint))
        mqtt_close()
        S.net = "mqtt"
        sleep_ms(3000)


# ===================== LUỒNG 2: CẢM BIẾN MÔI TRƯỜNG ==========================
def sensor_step():
    if dht is not None:
        with i2c_lock:
            t = dht.dht20_temperature()
            h = dht.dht20_humidity()
        S.temp, S.humi = t, h
        send("TEMP", t)
        send("HUMI", h)
    raw = LIGHT_PIN.read_analog()          # 0..4095
    if LIGHT_INVERT:
        raw = 4095 - raw
    S.light = round(raw * LIGHT_SCALE_MAX / 4095)
    send("LIGHT", S.light)


# ===================== LUỒNG 3: CẢM BIẾN CHUYỂN ĐỘNG PIR =====================
_pir_last = None
_pir_changed_at = 0


def motion_step():
    global _pir_last, _pir_changed_at
    value = 1 if PIR_PIN.read_digital() == 1 else 0
    now = ticks_ms()
    # chống dội: trạng thái mới phải giữ ít nhất 1 giây mới gửi (tránh tốn lượt Adafruit)
    if value != _pir_last and (_pir_last is None or ticks_diff(now, _pir_changed_at) > 1000):
        _pir_last, _pir_changed_at = value, now
        S.motion = value
        send("MOTION", value)


# ===================== LUỒNG 4: MÀN HÌNH LCD =================================
_lcd_cache = ["", ""]


def fmt(v, unit):
    return "--" + unit if v is None else ("%s%s" % (v, unit))


def lcd_step():
    if lcd is None:
        return
    line1 = "T:%s H:%s" % (fmt(S.temp, "C"), fmt(S.humi, "%"))
    if S.pass_display is not None:
        line2 = "Mat ma:" + "*" * len(S.pass_display)
    elif ticks_diff(S.msg_until, ticks_ms()) > 0:
        line2 = S.msg
    elif S.net == "wifi":
        line2 = "Dang noi WiFi..."
    elif S.net == "mqtt":
        line2 = "Dang noi MQTT..."
    else:
        line2 = "%s Q:%d%% %s" % ("DEN" if S.light_on else "den", S.fan,
                                   "MO" if S.door_open else "KHOA")
    for row, text in ((0, line1), (1, line2)):
        text = (text + " " * 16)[:16]     # ghi đè đủ 16 ký tự -> không cần clear(), không nháy
        if text != _lcd_cache[row]:
            with i2c_lock:
                lcd.move_to(0, row)
                lcd.putstr(text)
            _lcd_cache[row] = text


# ===================== LUỒNG 5: CỬA MẬT MÃ + REMOTE ==========================
def load_pass():
    try:
        with open(PASS_FILE) as f:
            p = f.read().strip()
            return p if p else DEFAULT_PASS
    except OSError:
        return DEFAULT_PASS


def save_pass(p):
    with open(PASS_FILE, "w") as f:
        f.write(p)


_door = {
    "password": load_pass(),
    "typed": "",
    "wrong": 0,
    "changing": False,           # đang nhập mật mã mới
    "last_input_at": 0,
    "auto_lock_at": None,
}


def move_door(open_it, source):
    servo_angle(DOOR_OPEN_ANGLE if open_it else DOOR_CLOSED_ANGLE)
    sleep_ms(600)                # chờ servo quay xong
    servo.duty(0)                # nhả servo cho đỡ tốn điện, đỡ rung (giống giáo trình)
    changed = S.door_open != open_it
    S.door_open = open_it
    _door["auto_lock_at"] = (ticks_ms() + DOOR_AUTO_LOCK_MS) if (open_it and source == "remote" and DOOR_AUTO_LOCK_MS) else None
    send("DOOR", 1 if open_it else 0)   # luôn báo trạng thái thật để web đồng bộ
    if changed and source == "remote":
        send("LOG", "Cua %s bang remote" % ("mo" if open_it else "khoa"))


def reset_typing():
    _door["typed"] = ""
    _door["changing"] = False
    S.pass_display = None


def handle_key(code):
    d = _door
    now = ticks_ms()
    if code in IR_DIGITS:
        if len(d["typed"]) < 8:
            d["typed"] += IR_DIGITS[code]
        S.pass_display = d["typed"]
        d["last_input_at"] = now
        beep(["C5:1"])
    elif code == IR_REMOTE_E:                      # E: xoá phần đã nhập
        reset_typing()
        beep(["C4:1"])
    elif code == IR_REMOTE_F:                      # F: xác nhận (giống giáo trình)
        typed = d["typed"]
        if d["changing"]:
            if len(typed) >= 3:
                d["password"] = typed
                save_pass(typed)
                show_msg("Da doi mat ma")
                send("LOG", "Doi mat ma cua bang remote")
                beep(["C5:1", "E5:1", "G5:1"])
            else:
                show_msg("Mat ma >= 3 so")
                beep(["C3:2"])
            reset_typing()
        elif typed == d["password"]:
            d["wrong"] = 0
            reset_typing()
            show_msg("Mo cua. A=doi MK", 5000)
            beep(["C5:1", "G5:1"])
            move_door(True, "remote")
        else:
            d["wrong"] += 1
            reset_typing()
            show_msg("Sai mat ma (%d/%d)" % (d["wrong"], MAX_WRONG))
            beep(["C3:2"])
            if d["wrong"] >= MAX_WRONG:
                d["wrong"] = 0
                S.alarm_until = ticks_ms() + 5000
                send("LOG", "Canh bao: nhap sai mat ma %d lan" % MAX_WRONG)
    elif code == IR_REMOTE_A and S.door_open:     # A khi cửa đang mở: đổi mật mã
        reset_typing()
        d["changing"] = True
        S.pass_display = ""
        d["last_input_at"] = now
        show_msg("Nhap MK moi + F", PASS_TIMEOUT_MS)
    elif code == IR_REMOTE_B and S.door_open:     # B: khoá cửa ngay
        move_door(False, "remote")


def door_step():
    d = _door
    now = ticks_ms()

    # 1) Lệnh cửa từ server (do luồng rx chuyển sang)
    with state_lock:
        req, S.door_request = S.door_request, None
    if req is not None:
        move_door(req[0], req[1])

    # 2) Tự khoá sau khi mở bằng remote
    if d["auto_lock_at"] is not None and ticks_diff(now, d["auto_lock_at"]) >= 0:
        move_door(False, "auto")

    # 3) Nhập dở quá lâu -> xoá
    if S.pass_display is not None and ticks_diff(now, d["last_input_at"]) > PASS_TIMEOUT_MS:
        reset_typing()

    # 4) Phím remote (giải mã chạy bằng ngắt + timer của thư viện, luồng này chỉ đọc kết quả)
    code = ir.get_code()
    if code is not None:
        # Giữ phím, remote gửi "mã lặp": thư viện trả lại mã cũ nhưng KHÔNG ghi raw_code.
        # Vì vậy raw_code = None nghĩa là đang giữ phím -> bỏ qua; bấm "1" hai lần vẫn nhận đủ.
        is_new_press = ir.get_raw_code() is not None
        ir.clear_code()
        if is_new_press:
            handle_key(code)


# ===================== LUỒNG CHÍNH: LOA / CÒI ================================
def play(notes):
    if music is not None:
        music.play(notes, wait=True)


def sound_step():
    alarm = S.buzzer_on or ticks_diff(S.alarm_until, ticks_ms()) > 0
    if alarm:
        play(["A5:2"])                   # hú từng nhịp ngắn để LCD/remote vẫn chạy xen kẽ
        return
    with state_lock:
        notes = S.beep_queue.pop(0) if S.beep_queue else None
    if notes:
        play(notes)


# ===================== KHỞI ĐỘNG ============================================
def safe_mode_requested():
    try:
        return button_b.is_pressed()
    except Exception:
        return False


def main():
    if safe_mode_requested():
        debug("Che do an toan: khong chay firmware (de nap lai chuong trinh)")
        return

    # trạng thái ban đầu: tắt đèn, tắt quạt, khoá cửa
    apply_light()
    set_fan(0)
    servo_angle(DOOR_CLOSED_ANGLE)
    sleep_ms(500)
    servo.duty(0)
    if lcd is not None:
        with i2c_lock:
            lcd.clear()
    show_msg("YoloHome: OK", 3000)

    # ---- LUỒNG THIẾT BỊ: tự lên lịch các việc theo chu kì riêng ----
    tasks = [  # [tên, hàm, chu kì ms, lần chạy kế tiếp]
        ["io", lambda: (motion_step(), door_step()), 100, 0],   # PIR + remote/cửa
        ["lcd", lcd_step, 500, 0],
        ["sound", sound_step, 50, 0],
        ["sensor", sensor_step, SENSOR_PERIOD_MS, 3000],       # đọc lần đầu sau 3s
    ]

    t0 = ticks_ms()
    for t in tasks:
        t[3] = t0 + t[3]

    def device_tick():
        now = ticks_ms()
        for t in tasks:
            if ticks_diff(now, t[3]) >= 0:
                t[3] = now + t[2]
                try:
                    t[1]()
                except Exception as e:
                    debug("Loi %s: %s" % (t[0], e))

    def device_loop():
        debug("Luong thiet bi bat dau")
        while S.running:
            device_tick()
            sleep_ms(10)
        debug("Luong thiet bi dung")

    threaded = True
    try:
        _thread.stack_size(THREAD_STACK)
    except Exception:
        pass
    gc.collect()
    try:
        _thread.start_new_thread(device_loop, ())
    except Exception as e:
        # Thường do luồng của lần chạy trước vẫn còn -> bấm nút RESET trên mạch rồi chạy lại.
        threaded = False
        debug("Khong tao duoc luong (%s): bam RESET mach roi chay lai. Tam chay 1 luong." % e)

    send("LOG", "Yolo:Bit khoi dong")
    send("DOOR", 0)
    beep(["C5:1", "E5:1", "G5:1"])

    # ---- LUỒNG CHÍNH: WiFi + MQTT (stack lớn sẵn có, đủ cho SSL) ----
    last_gc = ticks_ms()
    try:
        while True:
            mqtt_step()
            if threaded:
                sleep_ms(50)
            else:                                       # chế độ dự phòng: xen kẽ mạng + thiết bị
                for _ in range(5):
                    device_tick()
                    sleep_ms(10)
            if ticks_diff(ticks_ms(), last_gc) > 5000:
                gc.collect()
                last_gc = ticks_ms()
    except KeyboardInterrupt:
        pass                                            # app OhStem bấm Dừng (Ctrl-C)
    except Exception as e:
        debug("Luong chinh loi: %s" % e)
    finally:
        S.running = False                               # báo mọi luồng thoát
        sleep_ms(300)
        mqtt_close()
        S.light_on = False
        apply_light()
        set_fan(0)
        servo.duty(0)
        debug("Da dung firmware")


main()