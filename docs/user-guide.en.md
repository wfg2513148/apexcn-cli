# apexcn-cli User Guide

This guide is for APEX developers who use apexcn-cli through an AI tool. You do not need to memorize terminal commands or flags. Describe the intended outcome, let the AI assistant operate the CLI, and require a preview and explicit confirmation before any publish, update, or delete action.

Choose topic and reply ids from search results or content owned by the current account. The prompts below do not assume that a fixed id is valid online.

Every content change uses the same two-step confirmation. The AI first shows the business content and receives a short operation id. After you confirm, it uses that id to execute the exact change you reviewed. You do not need to manage directories or intermediate files.

## 1. First Use

Install the CLI first without supplying an API key:

> Please install apexcn-cli and its skill. Do not request, store, or verify an API key during installation. First confirm that the installed launcher resolves to the new version.

Configure authentication only after installation succeeds:

> I will set APEXCN_API_KEY in my own shell. Configure apexcn-cli to store only that environment variable name without reading or printing its value, then verify my account, category list, and search capability.

If it is already installed, say:

> Please check whether apexcn-cli is available and confirm which community account is currently logged in. Do not print the full API key.

## 2. Search Community Posts

> Use apexcn-cli to search for “APEX REST API” posts. Summarize the first 5 results and include each post's real URL and original URL.

> Search for “ORDS authentication failure” and group the results into “most useful”, “extra reading”, and “less related”.

> Search for “APEX JSON_TABLE” posts and order them from foundational to advanced.

## 3. Read and Summarize a Topic

> Select a topic from the previous search results and summarize what it is about. Include key steps, important notes, and the real URL.

> Read this topic and tell me whether it helps with my current issue: I cannot get JSON back when calling a REST API from APEX.

## 4. Check Account and Categories

> Check which community account apexcn-cli is currently logged in as.

> List the community categories I can post to and explain what each category is best for.

> Open my personal dashboard and show what I created, replied to, favorited, and subscribed to.

> Search for ORDS only inside my personal dashboard, not across the whole community. To limit the scope, say “search my favorites for ORDS.”

## 5. Ask Questions Against Community Content

To inspect personal-workbench support, say:

> Check the server capability inventory first, then read my notifications, inbox, community rules, and privacy policy. Report missing capabilities as unavailable and do not invent content.

> Use apexcn-cli to answer this from community content: How do I call a REST API from Oracle APEX? Include reference topic links.

> Based on community content, create a troubleshooting checklist for ORDS OAuth2 Bearer Token issues.

## 6. Draft a Topic

> I want to ask the community about APEX returning 401 when calling a REST API. Search related posts first, then draft a clear question. Do not publish it until I confirm.

> Help me write a community support topic from the issue below. Include background, what I tried, error messages, expected result, and tags. Show me the draft first; do not publish it directly.

## 7. Publish a Topic

If you are not ready to publish, say:

> Save the draft in the current profile's local draft inventory. When I ask for my drafts later, show only drafts owned by this profile.

For profile or machine migration:

> Export the current profile's local drafts, switch to the target profile, then import them. Do not show the API key or replace matching drafts unless I explicitly confirm.

> Publish the confirmed content to the right category. Before publishing, show me the selected category, title, body, and tags, then wait for my confirmation.

> Publish this topic. After it succeeds, send me the real topic URL.

## 8. Edit a Topic

> Select the target from my topics and make its title and body clearer. Show me the preview first; do not save it directly.

> Update that topic with the confirmed version and return the real topic URL.

## 9. Delete a Topic

> Select the target from my topics and confirm it is the one I want to delete. Show me its title, author, category, and link first.

> I confirm deleting the topic that was just previewed. Please follow the safe deletion flow and tell me the result.

## 10. Reply to a Topic

> Draft a friendly reply to the selected topic and add my solution. Show me the preview first; do not publish it directly.

> Publish the confirmed reply to that topic and send me the real topic URL.

> Reply to a specific reply under that topic with my additional test result. Preview first, then publish after I confirm.

For this request, the AI first confirms that the selected reply belongs to the selected topic and preserves its reply id in the preview so the publish cannot silently become a top-level reply.

## 11. Edit and Delete Replies

> Select the target from my replies and polish it. Show me the updated version first; do not save it directly.

> Update the selected reply with the confirmed text.

> Delete the selected reply. Before deleting, confirm that it is the reply I intended to remove.

The AI should also verify that the reply belongs to the current account and that the server permits deletion, then create the operation id with the freshly read content version. If the version changes, it must create a new preview instead of reusing the old operation id.

## 12. Favorite and Unfavorite

> Favorite the selected topic and send me the topic link.

> Remove the selected topic from my favorites.

## 13. Subscribe and Unsubscribe

> Subscribe to the selected topic so I can follow updates.

> Unsubscribe from the selected topic.

## 14. Turn Results into Notes

> Search for “APEX REST API” posts and turn the first 5 results into study notes. For each result include: who it is for, main idea, actionable steps, real URL, and original URL.

> Turn these posts into an “APEX REST API learning path”, ordered from foundational to advanced.

For local offline search:

> Build a BM25 index for my local collection, then query ORDS authentication failures with explain mode.

## 15. Change API Key or Reconfigure

> Help me reconfigure the apexcn-cli API key. I will provide the new key. Verify the account after configuration and do not print the full key.

You can also run `apexcn -apikey "your real API key"` yourself. Quotes are optional for an ordinary alphanumeric key. Replace the example text, and remember that the command may be retained in shell history.

## 16. Troubleshooting

> apexcn-cli seems broken. Please run the built-in diagnostics first, then check the install location, login state, account info, category list, and search capability. Tell me exactly which step failed.

> My AI tool does not seem to recognize apexcn-cli. Please check whether the skill is installed somewhere this AI tool can read.
