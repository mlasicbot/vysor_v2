"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const client_1 = require("react-dom/client");
const ChatApp_1 = require("./components/ChatApp");
require("./styles/global.css");
console.log('Vysor webview loading...');
const container = document.getElementById('root');
if (container) {
    console.log('Root container found, rendering ChatApp...');
    const root = (0, client_1.createRoot)(container);
    root.render((0, jsx_runtime_1.jsx)(ChatApp_1.ChatApp, {}));
}
else {
    console.error('Root container not found!');
}
//# sourceMappingURL=index.js.map