from yolobit import *
button_a.on_pressed = None
button_b.on_pressed = None
button_a.on_pressed_ab = button_b.on_pressed_ab = -1

from aiot_lcd1602 import LCD1602
from event_manager import *
from aiot_rgbled import RGBLed
from aiot_dht20 import DHT20
from machine import UART
import time


# Gateway Serial configuration.
SERIAL_ID = 1
SERIAL_BAUD = 115200

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
DOOR_OPEN_TIME_MS = 2000
TEMPERATURE_MIN = 18
TEMPERATURE_MAX = 35
HUMIDITY_MIN = 30
HUMIDITY_MAX = 80
LIGHT_MIN = 0
LIGHT_MAX = 100

aiot_lcd1602 = LCD1602()
aiot_dht20 = DHT20()
event_manager.reset()
tiny_rgb = RGBLed(RGB_PIN, RGB_COUNT)
serial = UART(0, baudrate=SERIAL_BAUD)

temperature = 0.0
humidity = 0.0
light = 0
motion = False
last_motion = False
door_open = False
door_close_deadline = 0
last_alert = ''
last_sensor_publish = -SENSOR_INTERVAL_MS
serial_buffer = ''


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


def set_light_color(value):
  value = value.strip().upper()
  if len(value) == 6:
    value = '#' + value
  if len(value) == 7 and value[0] == '#':
    try:
      tiny_rgb.show(0, hex_to_rgb(value))
    except (ValueError, TypeError):
      pass


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


def send_frame(data_type, value):
  try:
    frame = '!' + str(SERIAL_ID) + ':' + data_type + ':' + str(value) + '#'
    serial.write(frame.encode())
    return True
  except (OSError, ValueError, AttributeError):
    return False


def request_door_open():
  global door_close_deadline
  set_door_state('OPEN')
  door_close_deadline = time.ticks_add(time.ticks_ms(), DOOR_OPEN_TIME_MS)
  send_frame('DOOR', '1')


def service_door():
  if door_open and time.ticks_diff(time.ticks_ms(), door_close_deadline) >= 0:
    set_door_state('CLOSED')
    send_frame('DOOR', '0')


def show_message(value):
  aiot_lcd1602.clear()
  aiot_lcd1602.putstr(value[:32])


def handle_serial_frame(frame):
  parts = frame.strip('!#').split(':', 1)
  if len(parts) != 2:
    return
  command, value = parts[0].strip().upper(), parts[1].strip()
  if command == 'LIGHT':
    set_light(value.upper() in ('1', 'ON', 'TRUE'))
  elif command == 'COLOR':
    set_light_color(value)
  elif command == 'FAN':
    try:
      set_fan_state(int(float(value)))
    except ValueError:
      pass
  elif command == 'DOOR':
    value = value.upper()
    if value in ('1', 'OPEN', 'UNLOCK'):
      request_door_open()
    elif value in ('0', 'CLOSED', 'LOCK'):
      set_door_state('CLOSED')
      send_frame('DOOR', '0')
  elif command == 'MSG':
    show_message(value)


def read_serial():
  global serial_buffer
  try:
    waiting = serial.any()
    if waiting:
      serial_buffer += serial.read(waiting).decode('utf-8', 'ignore')
  except (OSError, ValueError, AttributeError):
    return
  while '!' in serial_buffer and '#' in serial_buffer:
    start = serial_buffer.find('!')
    end = serial_buffer.find('#', start)
    if end == -1:
      serial_buffer = serial_buffer[start:]
      return
    handle_serial_frame(serial_buffer[start:end + 1])
    serial_buffer = serial_buffer[end + 1:]
  if len(serial_buffer) > 256:
    serial_buffer = serial_buffer[-64:]


def publish_sensor_data():
  global last_sensor_publish
  now = time.ticks_ms()
  if time.ticks_diff(now, last_sensor_publish) < SENSOR_INTERVAL_MS:
    return True
  if not send_frame('TEMP', temperature):
    return False
  if not send_frame('HUMI', humidity):
    return False
  if not send_frame('LIGHT', light):
    return False
  if not send_frame('MOTION', 1 if motion else 0):
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
      send_frame('LOG', 'ALERT|' + alert)


def read_environment():
  global temperature, humidity, light, motion
  aiot_dht20.read_dht20()
  temperature = aiot_dht20.dht20_temperature()
  humidity = aiot_dht20.dht20_humidity()
  light = round(translate(LIGHT_PIN.read_analog(), 0, 4095, 0, 100))
  motion = PIR_PIN.read_digital() == 1
  display_environment()
  publish_sensor_data()
  publish_threshold_alert()
  if motion:
    set_light(True)


def update_motion():
  global motion, last_motion
  motion = PIR_PIN.read_digital() == 1
  if motion != last_motion:
    send_frame('MOTION', 1 if motion else 0)
    last_motion = motion
  if motion:
    set_light(True)


def on_environment_timer():
  try:
    read_environment()
  except (OSError, ValueError):
    aiot_lcd1602.clear()
    display_value('SENSOR ERROR', 0, 0)
    send_frame('LOG', 'SENSOR_ERROR')


event_manager.add_timer_event(SENSOR_INTERVAL_MS, on_environment_timer)
event_manager.add_timer_event(PIR_INTERVAL_MS, update_motion)


display.scroll('YoloHome')
aiot_lcd1602.clear()
aiot_lcd1602.backlight_on()
set_light(False)
set_fan_state(0)
set_door_state('CLOSED')
on_environment_timer()
display.scroll('Welcome')


while True:
  try:
    read_serial()
    service_door()
    event_manager.run()
  except (OSError, ValueError):
    pass
  time.sleep_ms(LOOP_INTERVAL_MS)
