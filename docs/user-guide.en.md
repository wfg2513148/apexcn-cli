# apexcn-cli Beginner Guide

This guide is for users who use apexcn-cli through an AI tool. You do not need to remember terminal commands or flags. Tell the AI agent what you want, let it operate the CLI, and ask it to preview important changes before publishing.

## 1. First Use

Prepare your APEX Chinese Community API key, then tell your AI tool:

> Please install and configure apexcn-cli for me. I will provide my APEX Chinese Community API key. After setup, verify my account, category list, and search capability.

If it is already installed, say:

> Please check whether apexcn-cli is available and confirm which community account is currently logged in. Do not print the full API key.

## 2. Search Community Posts

> Use apexcn-cli to search for “APEX REST API” posts. Summarize the first 5 results and include each post's real URL and original URL.

> Search for “ORDS authentication failure” and group the results into “most useful”, “extra reading”, and “less related”.

> Search for “APEX JSON_TABLE” posts and order them from beginner-friendly to advanced.

## 3. Read and Summarize a Topic

> Open topic 30549 and summarize what it is about. Include key steps, important notes, and the real URL.

> Read this topic and tell me whether it helps with my current issue: I cannot get JSON back when calling a REST API from APEX.

## 4. Check Account and Categories

> Check which community account apexcn-cli is currently logged in as.

> List the community categories I can post to and explain what each category is best for.

## 5. Ask Questions Against Community Content

> Use apexcn-cli to answer this from community content: How do I call a REST API from Oracle APEX? Include reference topic links.

> Based on community content, create a troubleshooting checklist for ORDS OAuth2 Bearer Token issues.

## 6. Draft a Topic

> I want to ask the community about APEX returning 401 when calling a REST API. Search related posts first, then draft a clear question. Do not publish it until I confirm.

> Help me write a community support topic from the issue below. Include background, what I tried, error messages, expected result, and tags. Show me the draft first; do not publish it directly.

## 7. Publish a Topic

> Publish the confirmed content to the right category. Before publishing, show me the selected category, title, body, and tags, then wait for my confirmation.

> Publish this topic. After it succeeds, send me the real topic URL.

## 8. Edit a Topic

> Open my topic 30549 and make the title and body clearer. Show me the preview first; do not save it directly.

> Update topic 30549 with the confirmed version and return the real topic URL.

## 9. Delete a Topic

> Open topic 30549 and confirm it is the one I want to delete. Show me its title, author, category, and link first.

> I confirm deleting topic 30549. Please follow the safe deletion flow and tell me the result.

## 10. Reply to a Topic

> Draft a friendly reply to topic 30549 and add my solution. Show me the preview first; do not publish it directly.

> Publish the confirmed reply to topic 30549 and send me the real topic URL.

> Reply to a specific reply under topic 30549 with my additional test result. Preview first, then publish after I confirm.

## 11. Edit and Delete Replies

> Open my reply 201480 and polish it. Show me the updated version first; do not save it directly.

> Update reply 201480 with the confirmed text.

> Delete reply 201480. Before deleting, confirm that it is the reply I intended to remove.

## 12. Favorite and Unfavorite

> Favorite topic 30549 and send me the topic link.

> Remove topic 30549 from my favorites.

## 13. Subscribe and Unsubscribe

> Subscribe to topic 30549 so I can follow updates.

> Unsubscribe from topic 30549.

## 14. Turn Results into Notes

> Search for “APEX REST API” posts and turn the first 5 results into study notes. For each result include: who it is for, main idea, actionable steps, real URL, and original URL.

> Turn these posts into an “APEX REST API beginner roadmap”, ordered from basic to advanced.

## 15. AI Agent / MCP

If your AI tool supports MCP, use the local stdio server in readonly mode by default:

> Check that apexcn-cli MCP is readonly and list the available tools.

Preview-only write tools can generate requests with `willExecute: false`, but real publishing still goes through CLI workflow.

For local offline search:

> Build a BM25 index for my local collection, then query ORDS authentication failures with explain mode.

## 16. Change API Key or Reconfigure

> Help me reconfigure the apexcn-cli API key. I will provide the new key. Verify the account after configuration and do not print the full key.

## 17. When Something Breaks

> apexcn-cli seems broken. Please run the built-in diagnostics first, then check the install location, login state, account info, category list, and search capability. Tell me exactly which step failed.

> My AI tool does not seem to recognize apexcn-cli. Please check whether the skill is installed somewhere this AI tool can read.
