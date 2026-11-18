# Glob matching for CLI development

This private development package uses the MIT-licensed source from [picomatch 4.0.7](https://www.npmjs.com/package/picomatch/v/4.0.7).

The upstream npm archive has integrity `sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`.

The parser forces `noextglob` after reading the caller's options. This disables the extglob compiler implicated by [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Standard file globs cover the project's test discovery patterns. The npm override selects this copy for the development dependency graph.
