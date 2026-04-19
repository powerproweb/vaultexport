# VaultExport — Path Configuration

## AI Chat History Vault Folder
All exported AI conversations (from VaultExport extension) are stored at:

```
M:\02_AI_Chat_Histories\recallos\
```

## Junction Link
`C:\Users\Juan Jose.DESKTOP-1K9D47O\Downloads\recallos` is a Windows directory
junction pointing to the folder above. When VaultExport saves files to
`Downloads\recallos\` they automatically land in `M:\02_AI_Chat_Histories\recallos\`.

## Ingesting into RecallOS
Run this command to index all exported conversations:

```powershell
$env:PYTHONUTF8=1
recallos ingest "M:\02_AI_Chat_Histories\recallos" --mode convos
```

## RecallOS Vault
Default vault: `C:\Users\Juan Jose.DESKTOP-1K9D47O\.recallos\vault\`

## Platforms
- ChatGPT exports → `M:\02_AI_Chat_Histories\recallos\chatgpt\`
- Claude exports  → `M:\02_AI_Chat_Histories\recallos\claude\`
- Flat exports (no RecallOS Mode) → `M:\02_AI_Chat_Histories\recallos\`
