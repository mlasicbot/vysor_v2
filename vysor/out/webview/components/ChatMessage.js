"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessage = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
require("./ChatMessage.css");
const ChatMessage = ({ message }) => {
    const isUser = message.role === 'user';
    return ((0, jsx_runtime_1.jsx)("div", { className: `chat-message ${isUser ? 'user' : 'assistant'}`, children: (0, jsx_runtime_1.jsxs)("div", { className: "message-content", children: [(0, jsx_runtime_1.jsxs)("div", { className: "message-header", children: [(0, jsx_runtime_1.jsx)("strong", { children: isUser ? 'You' : 'Vysor' }), (0, jsx_runtime_1.jsx)("span", { className: "timestamp", children: message.timestamp.toLocaleTimeString() })] }), (0, jsx_runtime_1.jsx)("div", { className: "message-text", children: message.content })] }) }));
};
exports.ChatMessage = ChatMessage;
//# sourceMappingURL=ChatMessage.js.map