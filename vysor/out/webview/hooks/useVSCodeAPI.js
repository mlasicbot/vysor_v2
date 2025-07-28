"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useVSCodeAPI = void 0;
const react_1 = require("react");
const useVSCodeAPI = () => {
    return (0, react_1.useMemo)(() => {
        if (typeof window !== 'undefined' && window.acquireVsCodeApi) {
            return window.acquireVsCodeApi();
        }
        return {
            postMessage: () => { },
            getState: () => ({}),
            setState: () => { }
        };
    }, []);
};
exports.useVSCodeAPI = useVSCodeAPI;
//# sourceMappingURL=useVSCodeAPI.js.map