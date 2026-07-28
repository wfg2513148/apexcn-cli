# apexcn-cli User Guide

This guide is for people who use an AI tool to access the APEX Chinese Community. You do not need to memorize commands or flags. Describe what you want to find, understand, or change, and let the AI operate the CLI.

## 1. Before You Start

You need:

- a computer with Node.js 20 or later;
- an APEX Chinese Community account;
- an API key for that account;
- a local AI tool that can run commands on your computer.

If apexcn-cli is not installed, tell your AI:

> Install apexcn-cli for me and verify the installed version. Do not ask for my API key during installation.

Get your API key by signing in to [APEX Chinese Community](https://oracleapex.cn/) and opening **API Key Management** from the account menu.

## 2. Connect Your API Key

For the shortest setup, run this in your own terminal:

```bash
apexcn -apikey "YOUR_API_KEY"
apexcn auth audit
```

Replace `YOUR_API_KEY` with the real key. This method may leave the command in your shell history.

On a shared computer or when you prefer not to store the key in the CLI configuration, use an environment variable.

macOS / Linux:

```bash
export APEXCN_API_KEY="YOUR_API_KEY"
apexcn auth set-token --token-env APEXCN_API_KEY
apexcn auth audit
```

Windows PowerShell:

```powershell
$env:APEXCN_API_KEY="YOUR_API_KEY"
apexcn auth set-token --token-env APEXCN_API_KEY
apexcn auth audit
```

Run `apexcn auth --help` whenever you need to see these setup instructions again.

Then tell your AI:

> Confirm which community account apexcn-cli is using and check that search works. Do not display the full API key.

## 3. Search and Read Community Content

> Search APEX Chinese Community for “APEX REST API”. Select the 5 most relevant topics and explain what each one helps with.

> Find discussions about “ORDS authentication failure” and group them into priority reading, extra reading, and background material.

> Show me new topics from the last 7 days, grouped by category.

> Read the selected topic and summarize its key steps, prerequisites, and cautions.

Results should include links that open the existing community pages. Imported content should also show its original source URL. References should use full topic titles, not internal evidence labels.

## 4. Answer Questions with Community Evidence

> Use existing community content to answer “How can Oracle APEX call a REST API?” Attach the supporting topic title and link to each important conclusion.

> Create an ORDS OAuth2 Bearer Token troubleshooting checklist from community discussions.

> Compare the solutions in the three selected topics, including common points, differences, applicable versions, and risks.

The AI should say when the available evidence is incomplete instead of inventing a source.

## 5. Use Your Personal Dashboard

> Open my personal dashboard and show what I created, replied to, favorited, and subscribed to.

> Show only my recently created topics.

> Search for ORDS only in my favorites and subscriptions, not across the whole community.

When you specify a personal scope, the AI should not silently expand the search to the full community.

## 6. Draft and Publish a Topic

> I receive a 401 when APEX calls a REST API. Search for similar discussions, then draft a support topic with my environment, steps, actual result, expected result, and attempted fixes. Do not publish it yet.

When the draft is ready:

> Publish the confirmed content in the right category. Show the category, title, body, and tags again, then wait for my confirmation.

After publishing, the AI should return a working link to the existing community topic page.

## 7. Edit or Delete Your Topic

> Find the target in my topics and make the title and body clearer. Preview the changes without saving them.

> Delete the selected topic. Show its title, category, author, and link, then wait for my confirmation.

Deletion is irreversible. The AI should stop if the target is unclear, the content changed, or the account lacks permission.

## 8. Reply and Manage Replies

> Draft a friendly reply to the selected topic and include my test result. Preview it without publishing.

> Reply to a specific message in that topic. Confirm that the message belongs to the selected topic before showing the preview.

> Edit my selected reply. Show the revised text and wait for confirmation before saving.

> Delete my selected reply. Confirm that it belongs to the current account and show its full content first.

## 9. Favorites, Subscriptions, and Correct Answers

> Favorite the selected topic and subscribe to future updates. Let me confirm the target first.

> Remove this topic from my favorites but keep the subscription.

> Show my favorites, including both topics and replies.

> Mark the selected reply as the correct answer. Confirm its content, current state, and my permission, then show a preview.

Only accounts with the required permission can mark or unmark a correct answer. The CLI follows the permission returned by the community service.

## 10. Why Changes Require Confirmation

Publishing, editing, deleting, favoriting, subscribing, and marking an answer use the same safety flow:

1. the AI reads the current target and shows a preview;
2. the CLI creates a short operation id for that preview;
3. you explicitly confirm;
4. the AI uses that id to execute the exact action you reviewed.

If the target, account, or state changes before confirmation, a new preview is required. You do not need to record or manage operation ids yourself.

## 11. Understand Returned Links

- **Community link** opens an existing topic, reply, or account page on APEX Chinese Community.
- **Original link** appears for imported content and opens the external source.
- **Protected page** may require you to sign in through the browser first.

The CLI API key does not automatically sign in the browser. If the browser asks you to sign in, use the normal community login instead of regenerating the API key.

## 12. Replace an API Key

If the key is lost or may have leaked, regenerate it in **API Key Management**, then tell your AI:

> Help me reconnect apexcn-cli with my new API key. Do not display the full key in replies, logs, or screenshots. Verify the current account afterward.

Regenerating the key immediately invalidates the old one.

## 13. Troubleshooting

Tell your AI:

> apexcn-cli does not seem to work. Check the installed version, API key configuration, current account, community connection, and search. Tell me which step fails without displaying the full API key.

Common cases:

- **`apexcn` not found**: restart the AI tool or terminal, then check the installation;
- **authentication failed**: run `apexcn auth audit` and reconnect the key if needed;
- **browser asks for sign-in**: sign in through the browser because CLI and browser sessions are separate;
- **a link does not open**: preserve the complete output and report an issue instead of editing the URL;
- **a change did not happen**: check whether the flow stopped at preview and still needs your confirmation.

For direct command usage, see the [Terminal Manual](cli-manual.en.md). For security details, see the [Security Model](security-model.md).
