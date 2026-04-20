---
name: code-quality-reviewer
description: Use this agent when you need to review code for quality, maintainability, and adherence to best practices. Examples:

  - After implementing a new feature or function:
    user: "I've just written a function to process user authentication"
    assistant: "Let me use the code-quality-reviewer agent to analyze the authentication function for code quality and best practices"

  - When refactoring existing code:
    user: "I've refactored the payment processing module"
    assistant: "I'll launch the code-quality-reviewer agent to ensure the refactored code maintains high quality standards"

  - Before committing significant changes:
    user: "I've completed the API endpoint implementations"
    assistant: "Let me use the code-quality-reviewer agent to review the endpoints for proper error handling and maintainability"

  - When uncertain about code quality:
    user: "Can you check if this validation logic is robust enough?"
    assistant: "I'll use the code-quality-reviewer agent to thoroughly analyze the validation logic"
tools: Glob, Grep, Read, WebFetch, TodoWrite, WebSearch, BashOutput, KillBash
model: inherit
---
