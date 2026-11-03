# Contributing to Dossier

Thanks for wanting to help. Bugs and ideas go in the issue forms; this page is about pull requests. How to set Dossier up and run its checks is in [DEVELOPMENT.md](DEVELOPMENT.md).

Please read the four rules below before you start. I'll close a pull request that doesn't follow them, however much work went into it.

## 1. For a new feature, open an issue first

Generating code with AI is easy. The hard part is keeping the product the way it should be. Nowadays anyone can code, but building something that brings value is hard. Therefore, discussion is more important than ever.

I've decided that I no longer accept any pull request that adds a feature without first discussing why it's needed and why it's good for people. A new feature, or a change to how something already works, starts as an issue, not as a pull request: say what you need it for, and wait until we've agreed on whether it fits and on a clear path for it before you write code. Some of Dossier's limits and defaults are there on purpose, such as the job agent's limit of three search requests a day, which keeps people within JSearch's free plan.

If a pull request that adds a feature doesn't link an issue in which the feature has been discussed and a clear path for it given, it will be closed, no matter how good the feature is.

Bug fixes don't need an issue first, and neither do small corrections to text or docs: send those as a pull request.

## 2. Before adding an AI provider, check the ones Dossier has

Many AI services speak OpenAI's API, and Dossier's **OpenAI-compatible** provider works with any of them: you enter the server's address, your API key and the model. OpenRouter, DeepSeek, Ollama's cloud, vLLM and Azure OpenAI are all used this way. So try the service with OpenAI-compatible first.

- **It works:** there's nothing to add. If the [Choosing an AI provider](https://github.com/AienTech/dossier/wiki/Choosing-an-AI-provider) page doesn't mention it, open an issue and I'll add it there.
- **It almost works,** because the server differs in a small way (its API is at another path, it needs a header, every request needs a field): add an entry in [`src/lib/ai/providers/servers.ts`](src/lib/ai/providers/servers.ts) and a test in `servers.test.ts`, not a provider of its own. The AI provider section of DEVELOPMENT.md explains how.
- **It can't work:** only then add a provider. That means the service's API isn't OpenAI's, as with Anthropic, or a feature needs the server's own API, as with LM Studio loading a model with enough context. Say in its issue what you tried with OpenAI-compatible and what failed.

## 3. Before adding a job source, check what it does with the user's data

A job source receives a search from the user's server and nothing more: the keywords, place, country, radius and filters, never anything from the profile ([PRIVACY.md](PRIVACY.md)). A new source has to keep to that.

- **Send only what the search needs.** No name, email, profile, resume or applications, and nothing that ties searches to a person beyond the key the source itself requires.
- **Check the source before writing code.** Read its privacy policy and terms. It mustn't gather information about the people searching or build profiles of them. Link both in its issue, and say what it collects.
- **Keep it on the server.** Searches go from Dossier's server to the source's own address. The browser never talks to a job source, so it can't be tracked there.
- **Update PRIVACY.md.** Its table says who receives what, and a new source adds itself there.

## 4. AI-written code is welcome, but review it yourself first

I review every pull request myself, and I don't accept bloated code. Before you open one, make sure you're in full control of what the AI wrote:

- **Read every line it wrote** and be able to explain it. If you find it hard to review, so will I.
- **Cut what the change doesn't need:** helpers nothing uses, options nobody asked for, checks for cases that can't happen, comments that repeat the code. Leave out files that aren't part of the change; your editor's and tools' settings belong in your global gitignore, not the project's.
- **Make one change per pull request,** on top of `main`, not on top of another open pull request.
- **Run the checks** ([Tests and checks](DEVELOPMENT.md#tests-and-checks)) and say what you tested and what you didn't.

## What happens to your pull request

When I take a change, I bring it into the next release myself and credit you in the release notes. The pull request is then closed with a link to that release, rather than merged.
