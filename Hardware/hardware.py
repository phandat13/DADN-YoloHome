from yolobit import *
button_a.on_pressed = None
button_b.on_pressed = None
button_a.on_pressed_ab = button_b.on_pressed_ab = -1

from mqtt import *
from aiot_lcd1602 import LCD1602
from event_manager import *
from aiot_rgbled import RGBLed
from aiot_dht20 import DHT20
import time


# Wi-Fi and Adafruit IO configuration.
WIFI_SSID = 'YOUR_WIFI_SSID'
WIFI_PASSWORD = 'YOUR_WIFI_PASSWORD'
AIO_SERVER = 'io.adafruit.com'
AIO_PORT = 1883
AIO_USERNAME = 'phandat13'
AIO_KEY = 'aio_REPLACE_WITH_YOUR_KEY'

# HOME:BIT wiring.
RGB_PIN = pin0.pin
LIGHT_PIN = pin2
PIR_PIN = pin3
DOOR_PIN = pin4
FAN_PIN = pin10
RGB_COUNT = 4
DOOR_OPEN_ANGLE = 100
DOOR_CLOSED_ANGLE = 0

# Timing and threshold configuration.
SENSOR_INTERVAL_MS = 30000
PIR_INTERVAL_MS = 100
LOOP_INTERVAL_MS = 10
RECONNECT_INTERVAL_MS = 5000
DOOR_OPEN_TIME_MS = 2000
TEMPERATURE_MIN = 18
TEMPERATURE_MAX = 35
HUMIDITY_MIN = 30
HUMIDITY_MAX = 80
LIGHT_MIN = 0
LIGHT_MAX = 100

# Adafruit IO feed names.
FEED_FAN = 'device-fan'
FEED_LIGHT = 'device-light'
FEED_DOOR_STATUS = 'door-status'
FEED_ALERT = 'hardware-log'
FEED_HUMIDITY = 'sensor-humidity'
FEED_LIGHT_SENSOR = 'sensor-light'
FEED_TEMPERATURE = 'sensor-temperature'
FEED_DOOR = 'smart-door'

aiot_lcd1602 = LCD1602()
aiot_dht20 = DHT20()
event_manager.reset()
tiny_rgb = RGBLed(RGB_PIN, RGB_COUNT)

temperature = 0.0
humidity = 0.0
light = 0
motion = False
ada_connected = False
door_open = False
door_close_deadline = 0
last_alert = ''
last_reconnect_attempt = 0
last_sensor_publish = -SENSOR_INTERVAL_MS


def display_value(value, x, y):
  aiot_lcd1602.move_to(x, y)
  aiot_lcd1602.putstr(str(value))


def display_environment():
  aiot_lcd1602.clear()
  display_value('T:', 0, 0)
  display_value(temperature, 2, 0)
  display_value('*C H:', 8, 0)
  display_value(humidity, 13, 0)
  display_value('L:', 0, 1)
  display_value(light, 2, 1)
  display_value('% PIR:', 7, 1)
  display_value(1 if motion else 0, 13, 1)


def set_light(is_on):
  if is_on:
    tiny_rgb.show(0, hex_to_rgb('#ffffff'))
  else:
    tiny_rgb.show(0, hex_to_rgb('#000000'))


def set_fan_state(percent):
  if percent < 0:
    percent = 0
  if percent > 100:
    percent = 100
  FAN_PIN.write_analog(round(translate(percent, 0, 100, 0, 1023)))


def set_door_state(state):
  global door_open
  if state == 'OPEN':
    DOOR_PIN.servo_write(DOOR_OPEN_ANGLE)
    door_open = True
  else:
    DOOR_PIN.servo_write(DOOR_CLOSED_ANGLE)
    door_open = False


def request_door_open():
  global door_close_deadline
  set_door_state('OPEN')
  door_close_deadline = time.ticks_add(time.ticks_ms(), DOOR_OPEN_TIME_MS)
  publish_message(FEED_DOOR_STATUS, 'OPEN')


def service_door():
  if door_open and time.ticks_diff(time.ticks_ms(), door_close_deadline) >= 0:
    set_door_state('CLOSED')
    publish_message(FEED_DOOR_STATUS, 'CLOSED')


def publish_message(feed, value):
  global ada_connected
  if not ada_connected:
    return False
  try:
    mqtt.publish(feed, value)
    return True
  except (OSError, ValueError):
    ada_connected = False
    return False


def connect_wifi():
  try:
    if mqtt.wifi_connected():
      return True
  except (OSError, AttributeError):
    pass
  try:
    mqtt.connect_wifi(WIFI_SSID, WIFI_PASSWORD)
    return True
  except (OSError, ValueError, Exception):
    return False


def connect_adafruit():
  global ada_connected
  try:
    if not mqtt.wifi_connected():
      ada_connected = False
      return False
    if ada_connected:
      return True
    mqtt.connect_broker(
      server=AIO_SERVER,
      port=AIO_PORT,
      username=AIO_USERNAME,
      password=AIO_KEY
    )
    mqtt.on_receive_message(FEED_FAN, on_fan_message)
    mqtt.on_receive_message(FEED_LIGHT, on_light_message)
    mqtt.on_receive_message(FEED_DOOR, on_door_message)
    ada_connected = True
    return True
  except Exception:
    ada_connected = False
    return False


def on_fan_message(message):
  value = str(message).strip()
  if value == '2':
    set_fan_state(100)
  elif value == '1':
    set_fan_state(40)
  else:
    set_fan_state(0)


def on_light_message(message):
  value = str(message).strip().upper()
  set_light(value == '1' or value == 'ON')


def on_door_message(message):
  value = str(message).strip().upper()
  if value == '1' or value == 'OPEN' or value == 'UNLOCK':
    request_door_open()
  elif value == '0' or value == 'CLOSED' or value == 'LOCK':
    set_door_state('CLOSED')
    publish_message(FEED_DOOR_STATUS, 'CLOSED')


def publish_sensor_data():
  global last_sensor_publish
  now = time.ticks_ms()
  if time.ticks_diff(now, last_sensor_publish) < SENSOR_INTERVAL_MS:
    return True
  if not publish_message(FEED_TEMPERATURE, temperature):
    return False
  if not publish_message(FEED_HUMIDITY, humidity):
    return False
  if not publish_message(FEED_LIGHT_SENSOR, light):
    return False
  last_sensor_publish = now
  return True


def publish_threshold_alert():
  global last_alert
  warnings = []
  if temperature < TEMPERATURE_MIN or temperature > TEMPERATURE_MAX:
    warnings.append('TEMPERATURE:' + str(temperature))
  if humidity < HUMIDITY_MIN or humidity > HUMIDITY_MAX:
    warnings.append('HUMIDITY:' + str(humidity))
  if light < LIGHT_MIN or light > LIGHT_MAX:
    warnings.append('LIGHT:' + str(light))
  alert = '|'.join(warnings)
  if alert != last_alert:
    last_alert = alert
    if alert:
      tiny_rgb.show(0, hex_to_rgb('#ff0000'))
      publish_message(FEED_ALERT, 'ALERT|' + alert)


def read_environment():
  global temperature, humidity, light, motion
  aiot_dht20.read_dht20()
  temperature = aiot_dht20.dht20_temperature()
  humidity = aiot_dht20.dht20_humidity()
  light = round(translate(LIGHT_PIN.read_analog(), 0, 4095, 0, 100))
  motion = PIR_PIN.read_digital() == 1
  display_environment()
  if ada_connected:
    publish_sensor_data()
    publish_threshold_alert()
  if motion:
    set_light(True)


def update_motion():
  global motion
  motion = PIR_PIN.read_digital() == 1
  if motion:
    set_light(True)


def on_environment_timer():
  try:
    if connect_adafruit():
      read_environment()
  except (OSError, ValueError):
    aiot_lcd1602.clear()
    display_value('SENSOR ERROR', 0, 0)
    if ada_connected:
      publish_message(FEED_ALERT, 'SENSOR_ERROR')


event_manager.add_timer_event(SENSOR_INTERVAL_MS, on_environment_timer)
event_manager.add_timer_event(PIR_INTERVAL_MS, update_motion)


if True:
  display.scroll('YoloHome')
  aiot_lcd1602.clear()
  aiot_lcd1602.backlight_on()
  set_light(False)
  set_fan_state(0)
  set_door_state('CLOSED')
  connect_wifi()
  connect_adafruit()
  on_environment_timer()
  display.scroll('Welcome')


while True:
  try:
    now = time.ticks_ms()
    if not ada_connected and time.ticks_diff(now, last_reconnect_attempt) >= RECONNECT_INTERVAL_MS:
      last_reconnect_attempt = now
      if connect_wifi():
        connect_adafruit()
    if ada_connected:
      try:
        mqtt.check_message()
      except (OSError, ValueError):
        ada_connected = False
    service_door()
    event_manager.run()
  except (OSError, ValueError):
    ada_connected = False
  time.sleep_ms(LOOP_INTERVAL_MS)
