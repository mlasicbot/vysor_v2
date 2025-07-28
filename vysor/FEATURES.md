# Vysor Features

## @ File Reference Autocomplete

Vysor now includes an intelligent autocomplete system that appears when you type `@` in the chat input. This feature helps you easily reference files and folders in your workspace.

### How to Use

1. **Type `@`** in the chat input field
2. **Autocomplete dropdown appears** showing files and folders in your workspace
3. **Navigate with arrow keys** (↑/↓) or click to select
4. **Press Enter** or click to insert the file reference
5. **Continue typing** your message

### Features

- **Real-time filtering**: As you type after `@`, the dropdown filters to show matching files
- **Visual indicators**: 
  - 📁 for folders
  - 📄 for files
- **Keyboard navigation**: Use arrow keys to navigate the dropdown
- **Click support**: Click on any item to select it
- **Escape to close**: Press Escape to close the dropdown
- **Smart file filtering**: Only shows relevant file types (code files, docs, etc.)
- **Performance optimized**: Limits directory depth to prevent slowdowns

### Supported File Types

The autocomplete includes these file types:
- `.js`, `.ts`, `.jsx`, `.tsx` (JavaScript/TypeScript)
- `.json` (Configuration files)
- `.md` (Documentation)
- `.txt` (Text files)
- `.py` (Python)
- `.cpp`, `.c`, `.h`, `.hpp` (C/C++)

### Example Usage

```
@src/panels/VysorPanel.ts - Include a specific TypeScript file
@hardware_test_code/ - Include all files in a directory
@package.json - Include configuration file
```

The referenced files will be automatically included as context when you send your message to the AI assistant. 