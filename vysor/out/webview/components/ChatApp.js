"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatApp = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const ChatMessage_1 = require("./ChatMessage");
const ChatInput_1 = require("./ChatInput");
const useVSCodeAPI_1 = require("../hooks/useVSCodeAPI");
require("./ChatApp.css");
const ChatApp = () => {
    console.log('ChatApp component rendering...');
    const [messages, setMessages] = (0, react_1.useState)([
        {
            id: '1',
            role: 'assistant',
            content: 'Hello! How can I help you today?',
            timestamp: new Date()
        },
        {
            id: '2',
            role: 'assistant',
            content: '💡 Tip: Use @filename to include files as context. Examples: @hardware_test_code/code.txt or @/home/azureuser/vysor/hardware_test_code/code.txt',
            timestamp: new Date()
        }
    ]);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const messagesEndRef = (0, react_1.useRef)(null);
    const vscode = (0, useVSCodeAPI_1.useVSCodeAPI)();
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    (0, react_1.useEffect)(() => {
        scrollToBottom();
    }, [messages]);
    (0, react_1.useEffect)(() => {
        const handleMessage = (event) => {
            const message = event.data;
            if (message.type === 'response') {
                const newMessage = {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: message.text,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, newMessage]);
                setIsLoading(false);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);
    const handleSendMessage = async (content) => {
        if (!content.trim())
            return;
        const userMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: content.trim(),
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        vscode.postMessage({
            type: 'query',
            text: content.trim()
        });
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "chat-app", children: [(0, jsx_runtime_1.jsxs)("div", { className: "chat-messages", children: [messages.map((message) => ((0, jsx_runtime_1.jsx)(ChatMessage_1.ChatMessage, { message: message }, message.id))), isLoading && ((0, jsx_runtime_1.jsx)("div", { className: "loading-indicator", children: (0, jsx_runtime_1.jsxs)("div", { className: "typing-indicator", children: [(0, jsx_runtime_1.jsx)("span", {}), (0, jsx_runtime_1.jsx)("span", {}), (0, jsx_runtime_1.jsx)("span", {})] }) })), (0, jsx_runtime_1.jsx)("div", { ref: messagesEndRef })] }), (0, jsx_runtime_1.jsx)(ChatInput_1.ChatInput, { onSendMessage: handleSendMessage, disabled: isLoading })] }));
};
exports.ChatApp = ChatApp;
//# sourceMappingURL=ChatApp.js.map