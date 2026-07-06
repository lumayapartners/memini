Output "/private/tmp/claude-501/-Users-tanmay-Documents-ai-memory/fb457ad2-d3b3-4ef8-bc70-34b1d4b15cbb/scratchpad/memini-demo.gif"

Set Shell "bash"
Set FontSize 17
Set Width 1180
Set Height 800
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 45ms

Hide
Type "cd /private/tmp/claude-501/-Users-tanmay-Documents-ai-memory/fb457ad2-d3b3-4ef8-bc70-34b1d4b15cbb/scratchpad/memini-demo" Enter
Type "export PATH=/private/tmp/claude-501/-Users-tanmay-Documents-ai-memory/fb457ad2-d3b3-4ef8-bc70-34b1d4b15cbb/scratchpad/bin:/Users/tanmay/.nvm/versions/node/v22.17.0/bin:$HOME/.local/bin:$PATH" Enter
Type "clear" Enter
Show

Sleep 800ms
Type "# Last week a coding agent broke this Vercel deploy editing vercel.json." Sleep 400ms Enter
Type "# The real fix was elsewhere. memini recorded the lesson in the repo:" Sleep 400ms Enter
Sleep 600ms
Type "pm recall --file vercel.json" Sleep 400ms Enter
Sleep 3.5s

Enter
Type "# New session. Fresh agent. No memory of last week." Sleep 400ms Enter
Type "# It's asked to fix the deploy and reaches for vercel.json again..." Sleep 400ms Enter
Sleep 800ms
Type "agent-edit vercel.json" Sleep 400ms Enter
Sleep 6s

Enter
Type "# The edit was stopped BEFORE it happened — a hook, not a note the agent" Sleep 300ms Enter
Type "# chose to read. Given the recorded history, here's what the agent did:" Sleep 300ms Enter
Sleep 600ms
Type `echo "  \"I didn't make the change. A guardrail flagged that editing"` Sleep 300ms Enter
Type `echo "   buildCommand already took prod down for an hour. The real fix is"` Sleep 300ms Enter
Type `echo "   moving checkout server-side — applying that instead.\""` Sleep 300ms Enter
Sleep 1.5s
Type "git diff --stat   # vercel.json untouched. The mistake didn't repeat." Sleep 400ms Enter
Sleep 3.5s
