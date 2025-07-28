"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatInput = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
require("./ChatInput.css");
const ChatInput = ({ onSendMessage, disabled = false }) => {
    console.log('ChatInput component rendering...');
    const [inputValue, setInputValue] = (0, react_1.useState)('');
    const handleSubmit = () => {
        if (inputValue.trim() && !disabled) {
            onSendMessage(inputValue);
            setInputValue('');
        }
    };
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "chat-input-container", children: [(0, jsx_runtime_1.jsx)("input", { type: "text", value: inputValue, onChange: (e) => setInputValue(e.target.value), onKeyPress: handleKeyPress, placeholder: "Ask a hardware question...", disabled: disabled, className: "chat-input" }), (0, jsx_runtime_1.jsx)("button", { onClick: handleSubmit, disabled: disabled || !inputValue.trim(), className: "send-button", children: "\u27A4" })] }));
};
exports.ChatInput = ChatInput;
//# sourceMappingURL=ChatInput.js.map