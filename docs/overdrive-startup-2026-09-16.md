# Startup repair — 2026-09-16

The installed 2.0.17 app passed strict deep codesign verification but closed a few seconds
after every launch. Its logs showed orderly shutdown, not a crash.

Cause: submitted launchd job `com.malachi.overdrive.hotfix.1789551360` had KeepAlive enabled.
Its installer script `/tmp/malachi-overdrive-hotfix-20260916-093600.sh` successfully installed
the update at 09:36:10 UTC, then restarted repeatedly. Each retry told Overdrive to quit
before checking whether the staging bundle still existed. After successful promotion the
staging bundle was absent, so retries exited 21 and repeated about every ten seconds.

Removed the obsolete job with `launchctl remove com.malachi.overdrive.hotfix.1789551360`.
Confirmed no matching installer process or job remained, then reopened the installed app.
The window loaded and displayed Connected. The installed bundle, backup, chats and settings
were preserved; no application source or permissions changed.

Future one-shot installers must not use unconditional KeepAlive. Validate remaining work
before requesting app shutdown, and retire the installer after success or terminal failure.
