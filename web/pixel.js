let ble_device;
let gattServer;
let commandService;
let writeCharacteristic;
let readNotifyCharacteristic;
let busy = false;
let is_drawing = false;
let commandQueue = [];
let current_save_slot = 0;

const WRITE_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8"
const READ_NOTIFY_CHARACTERISTIC_UUID = "e50fc8b7-42d6-4047-bc03-b2a92905d480"
const pixels = document.getElementById("pixel_container");
const clear_btn = document.getElementById("clear_btn");
const save_btn = document.getElementById("save_btn");
const color_selection = document.getElementById("pixel_color");
let pixel_color = color_selection.value;
const pallete = document.getElementById("pallete");

const colors = [
  "#000000", // Black
  "#C0C0C0", // Silver
  "#808080", // Gray
  "#FFFFFF", // White
  "#800000", // Maroon
  "#FF0000", // Red
  "#800080", // Purple
  "#FF00FF", // Fuchsia
  "#008000", // Green
  "#00FF00", // Lime
  "#008080", // Teal
  "#00FFFF", // Aqua
  "#000080", // Navy
  "#0000FF", // Blue
  "#FF8000", // Orange
  "#FFFF00", // Yellow];
];

function createTable() {
  const numRows = 8;
  const numCols = 8;

  let tdId = 0;
  let id = 0;
  for (let i = 0; i < numRows; i++) {
    const row = document.createElement("tr");
    for (let j = 0; j < numCols; j++) {
      const cell = document.createElement("td");

      cell.style.backgroundColor = "black";
      if (i % 2 === 0) {
        // Even rows (0, 2, 4, ...)
        id = tdId + (numCols - 1 - j);
        cell.id = `${id}`;
      } else {
        // Odd rows (1, 3, 5, ...)
        cell.id = `${tdId}`;
        tdId++;
      }
      row.appendChild(cell);
    }
    if (i % 2 === 0) {
      tdId += 8;
    }
    pixels.appendChild(row);
  }
}
const rgb2hex = (rgb) =>
  `#${rgb
    .match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
    .slice(1)
    .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
    .join("")}`;

function createPallete() {
  const numRows = 2;
  const numCols = 8;

  let tdId = 0;

  for (let i = 0; i < numRows; i++) {
    const row = document.createElement("tr");
    for (let j = 0; j < numCols; j++) {
      const cell = document.createElement("td");
      cell.id = `${tdId}`;
      cell.style.backgroundColor = colors[tdId];
      tdId++;
      cell.addEventListener("click", () => {
        const c = cell.style.backgroundColor;
        pixel_color = rgb2hex(c);
      });
      row.appendChild(cell);
    }
    pallete.appendChild(row);
  }
}

color_selection.addEventListener("change", () => {
  pixel_color = color_selection.value;
});

pixels.addEventListener("mousedown", (event) => {
  event.preventDefault();
  is_drawing = event.button === 0 ? true : false;
  paint_tile(event.target);
});

pixels.addEventListener("mouseup", (event) => {
  event.preventDefault();
  is_drawing = false;
});

pixels.addEventListener("mouseleave", (event) => {
  event.preventDefault();
  is_drawing = false;
});


pixels.addEventListener("mouseover", (event) => {
  event.preventDefault();
  if (is_drawing) {
    paint_tile(event.target);
  }
});

function setup_save_slots() {
  const saves = document.getElementsByClassName("save")
  console.log(saves);
  const savesArray = Array.from(saves);
  savesArray.forEach((s, i) => {
    s.addEventListener("click", () => {
      current_save_slot = i
      sendChangeSaveSlot(i)
      loadSaveToGrid(i);
    })
  });
}

function convertHexColorToInt(hexColor) {
  hexColor = hexColor.replace("#", "");
  const intColor = parseInt(hexColor, 16);
  return `0x${intColor.toString(16)}`;
}

function rgbToHex(r, g, b) {
  function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }
  return "0x" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function paint_tile(tar) {
  if (tar.nodeName === "TD") {
    tar.style.backgroundColor = pixel_color;
    const color = pixel_color.replace("#", "0x");
    const cmd = new TextEncoder().encode([tar.id, color]);
    sendCommand(cmd);
  }
}

function resetVariables() {
  busy = false;
  ble_device = null;
  gattServer = null;
  commandService = null;
  writeCharacteristic = null;
  readNotifyCharacteristic = null;
  save_slot = 0;
}

function handleError(error) {
  console.log(error);
  resetVariables();
}

function clearPanel() {
  const tdElements = pixels.querySelectorAll("td");
  const cmd = new TextEncoder().encode(["c", "0"]);

  if (ble_device) {
    sendCommand(cmd);
    console.log("clear");
  }
  tdElements.forEach((td) => {
    td.style.backgroundColor = "black";
  });
  saveGridToCanvas(current_save_slot)
}

clear_btn.addEventListener("click", () => {
  clearPanel();
});

save_btn.addEventListener("click", () => {
  const cmd = new TextEncoder().encode(["w", current_save_slot]);
  if (ble_device) {
    sendCommand(cmd);
    saveGridToCanvas(current_save_slot)
  }
});

function sendCommand(cmd) {
  if (writeCharacteristic) {
    // Handle one command at a time

    if (busy) {
      // Queue commands
      commandQueue.push(cmd);
      return Promise.resolve();
    }
    busy = true;

    return writeCharacteristic.writeValue(cmd).then(() => {
      busy = false;
      // Get next command from queue
      let nextCommand = commandQueue.shift();
      updateProgressBar();
      if (nextCommand) {
        sendCommand(nextCommand);
      }
    });
  } else {
    return Promise.resolve();
  }
}

function updateProgressBar() {
  const progressBar = document.getElementById("progress-bar");
  const percentage = (commandQueue.length / 10) * 100;
  progressBar.style.width = `${percentage}%`;
}

document.addEventListener("DOMContentLoaded", () => {
  createPallete();
  const connect_button = document.getElementById("ble_connect");
  const discon_button = document.getElementById("ble_disconnect");
  setup_save_slots();
  discon_button.addEventListener("click", () => {
    if (!ble_device) {
      return;
    }
    console.log("Disconnecting from Bluetooth Device...");
    if (ble_device.gatt.connected) {
      ble_device.gatt.disconnect();
    } else {
      console.log("> Bluetooth Device is already disconnected");
    }
  });

  connect_button.addEventListener("click", () => {
    connectToDevice();
  });
});

window.onbeforeunload = function (event) {
  console.log("Disconnecting from BLE device");
  if (ble_device.gatt.connected) {
    ble_device.gatt.disconnect();
  }
};

function setupCharacteristics(readNotifyCharacteristic) {

  // Start notifications:
  readNotifyCharacteristic.startNotifications()
    .then(() => {
      console.log('Notifications started');
      readNotifyCharacteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
    }).then(() => {
      loadSavesFromDevice();
    })
    .catch(error => {
      console.error('Error starting notifications:', error);
    });
}

function handleCharacteristicValueChanged(event) {
  const value = event.target.value;
  const uint8Array = new Uint8Array(value.buffer);

  console.log('Received LED data (Uint8Array):', uint8Array);

  drawRGBArrayToCanvas(uint8Array, current_save_slot);
}

async function connectToDevice() {
  console.log("Connecting...");
  try {
    ble_device = await navigator.bluetooth.requestDevice({
      filters: [
        {
          namePrefix: "PixelDisplay",
        },
      ],
      optionalServices: ["4fafc201-1fb5-459e-8fcc-c5c9c331914b"],
    });

    console.log(ble_device);
    console.log("Connecting to GATT Server...");
    gattServer = await ble_device.gatt.connect();

    console.log("> Found GATT server");
    commandService = await gattServer.getPrimaryService("4fafc201-1fb5-459e-8fcc-c5c9c331914b");

    console.log("> Found command service");
    [writeCharacteristic, readNotifyCharacteristic] = await Promise.all([
      commandService.getCharacteristic(WRITE_CHARACTERISTIC_UUID),
      commandService.getCharacteristic(READ_NOTIFY_CHARACTERISTIC_UUID),
    ]);

    console.log('Write Characteristic:', writeCharacteristic);
    console.log('Read/Notify Characteristic:', readNotifyCharacteristic);
    setupCharacteristics(readNotifyCharacteristic);
  } catch (error) {
    handleError(error);
  }
}

function drawRGBArrayToCanvas(rgbArray, save_slot) {
  const canvasId = "save_" + save_slot;
  const canvas = document.getElementById(canvasId);

  if (!canvas) {
    console.error("Canvas element with ID '" + canvasId + "' not found.");
    return;
  }

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (!ctx) {
    console.error("Canvas context not available.");
    return;
  }

  const canvasSize = 8; // 8x8 canvas
  const pixelSize = canvas.width / canvasSize; // Calculate pixel size

  if (rgbArray.length !== canvasSize * canvasSize * 3) {
    console.error("RGB array length is incorrect. Expected " + (canvasSize * canvasSize * 3) + " elements, but got " + rgbArray.length + ".");
    return;
  }

  for (let row = 0; row < canvasSize; row++) {
    const rowStartIndex = row * canvasSize * 3;

    if (row % 2 === 0) {
      for (let col = canvasSize - 1; col >= 0; col--) {
        const pixelStartIndex = rowStartIndex + col * 3;
        const r = rgbArray[pixelStartIndex];
        const g = rgbArray[pixelStartIndex + 1];
        const b = rgbArray[pixelStartIndex + 2];

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect((canvasSize - 1 - col) * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }

    }
    else {
      for (let col = 0; col < canvasSize; col++) {
        const pixelStartIndex = rowStartIndex + col * 3;
        const r = rgbArray[pixelStartIndex];
        const g = rgbArray[pixelStartIndex + 1];
        const b = rgbArray[pixelStartIndex + 2];

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}

function loadSaveToGrid(save_slot) {
  const canvasId = "save_" + save_slot;
  const canvas = document.getElementById(canvasId);
  var ctx = canvas.getContext("2d");
  const canvasSize = 8;
  const pixelSize = canvas.width / canvasSize;

  for (let row = 0; row < canvasSize; row++) {
    for (let col = canvasSize - 1; col >= 0; col--) {
      let pixel_id;
      if (row % 2 === 0) {
        pixel_id = row * canvasSize + (canvasSize - 1 - col); // Right-to-left index
      } else {
        pixel_id = row * canvasSize + col; // Left-to-right index
      }

      const x = col * pixelSize;
      const y = row * pixelSize;

      const saved_pixel_data = ctx.getImageData(x, y, 1, 1).data;
      const r = saved_pixel_data[0];
      const g = saved_pixel_data[1];
      const b = saved_pixel_data[2];
      const pixel = document.getElementById(pixel_id);
      pixel.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }

  }
}

function saveGridToCanvas(save_slot) {
  const canvasId = "save_" + save_slot;
  const canvas = document.getElementById(canvasId);
  var ctx = canvas.getContext("2d");
  const canvasSize = 8;
  const pixelSize = canvas.width / canvasSize;

  for (let row = 0; row < canvasSize; row++) {
    const rowStartIndex = row * canvasSize;

    if (row % 2 === 0) {
      for (let col = canvasSize - 1; col >= 0; col--) {
        const pixel_id = rowStartIndex + col;
        const pixel = document.getElementById(pixel_id);
        ctx.fillStyle = pixel.style.backgroundColor
        ctx.fillRect((canvasSize - 1 - col) * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }

    }
    else {
      for (let col = 0; col < canvasSize; col++) {
        const pixel_id = rowStartIndex + col;
        const pixel = document.getElementById(pixel_id);
        ctx.fillStyle = pixel.style.backgroundColor
        ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}

function loadSavesFromDevice() {
  let index = 0;

  function sendNext() {
    if (index < 4) {
      current_save_slot = index;
      const cmd = new TextEncoder().encode(["l", index + '\0']);
      console.log("Sending ", index);
      index++;
      sendCommand(cmd);
      setTimeout(sendNext, 200);
    } else {
      current_save_slot = 0;
    }
  }
  sendNext();

}

function sendChangeSaveSlot(save_slot) {
  const cmd = new TextEncoder().encode(["s", save_slot + '\0']);
  sendCommand(cmd);
}