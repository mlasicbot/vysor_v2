"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
class MessageHandler {
    constructor() {
        this.messageHistory = [];
    }
    addMessage(role, content) {
        this.messageHistory.push({ role, content });
    }
    getHistory() {
        return [...this.messageHistory];
    }
    clearHistory() {
        this.messageHistory = [];
    }
    getHistoryLength() {
        return this.messageHistory.length;
    }
}
exports.MessageHandler = MessageHandler;
//# sourceMappingURL=MessageHandler.js.map