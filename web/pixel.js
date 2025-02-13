let ble_device;
let gattServer;
let commandService;
let writeCharacteristic;
let busy = false;
let is_drawing = false;
let commandQueue = [];
// TODO
const pixels = document.getElementById("pixel_container");
const clear_btn = document.getElementById("clear_btn");
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

pixels.addEventListener("mouseover", (event) => {
  event.preventDefault();
  if (is_drawing) {
    paint_tile(event.target);
  }
});

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
}

function handleError(error) {
  console.log(error);
  resetVariables();
}

function clearPanel() {
  const tdElements = pixels.querySelectorAll("td");
  const cmd = new TextEncoder().encode(-1);
  if (ble_device) {
    sendCommand(cmd);
  }
  tdElements.forEach((td) => {
    td.style.backgroundColor = "black";
  });
}

clear_btn.addEventListener("click", () => {
  clearPanel();
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

  discon_button.addEventListener("click", () => {
    if (!ble_device) {
      return;
    }
    console.log("Disconnecting from Bluetooth Device...");
    if (ble_device.gatt.connected) {
      ble_device.gatt.disconnect();
      // TODO add disable connect button for 1 second
      // to allow for disconnect command
    } else {
      console.log("> Bluetooth Device is already disconnected");
    }
  });

  connect_button.addEventListener("click", () => {
    console.log("Connecting...");
    ble_device = null;
    navigator.bluetooth
      .requestDevice({
        filters: [
          {
            namePrefix: "PixelDisplay",
          },
        ],
        optionalServices: ["4fafc201-1fb5-459e-8fcc-c5c9c331914b"],
      })
      .then((device) => {
        ble_device = device;
        console.log(device);
        console.log("Connecting to GATT Server...");
        return ble_device.gatt.connect();
      })
      .then((server) => {
        console.log("> Found GATT server");
        gattServer = server;
        // Get command service
        return gattServer.getPrimaryService(
          "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
        );
      })
      .then((service) => {
        console.log("> Found command service");
        commandService = service;
        // Get write characteristic
        return commandService.getCharacteristic(
          "beb5483e-36e1-4688-b7f5-ea07361b26a8"
        );
      })
      .then((characteristic) => {
        console.log("> Found write characteristic");
        writeCharacteristic = characteristic;
      })
      .catch(handleError);
  });
});

window.onbeforeunload = function (event) {
  console.log("Disconnecting from BLE device");
  if (ble_device.gatt.connected) {
    ble_device.gatt.disconnect();
    // TODO add disable connect button for 1 second
    // to allow for disconnect command
  }
};
