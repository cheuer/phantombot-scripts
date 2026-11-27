# phantombot-scripts
This is a collection of scripts for [PhantomBot](https://github.com/PhantomBot/PhantomBot)

## alttpr.js
This script is for running a GTBK / Agahnim blue ball guessing game for A Link to the Past Randomizer.

### Installation
Just copy alttpr.js to somewhere under the PhantomBot/scripts directory. I like to put it in a folder named "custom" but that isn't actually required.

### Main Functions

* !bk or !bk start

  Starts the Ganon's Tower Big Key guessing game

* !bk stop

  Ends the guessing period, no more guesses in chat will be recorded

* !bk `number`

  Declares one or more winners as the chat users with the exact right guess or the closest to it. Preference is given to the number lower than the correct answer in case of a tie. Also prints the leaderboard.

* !bl

  Same as !bk, but for blue ball attacks from Agahnim

### Utility Functions
All of these can be preceded by !bk or !bl, doesn't matter

* !bk help

  Prints a list of commands

* !bk cancel

  Cancels the guessing game and deletes the saved guesses. Useful if you started it accidentally, or want to start over for some reason.

* !bk print

  Prints the leaderboard

* !bk reset

  Resets the leaderboard

* !bk set `name` `number`

  Sets a specific number of wins on the leaderboard for a user

* !bk timer

  Shows the current timer setting

* !bk timer `number`

  Sets the timer length, in seconds. This will automatically end the game after the given number of seconds. This setting persists across games, so you can set it and forget it. You can still call !bk stop to stop the timer early.

* !bk guess

  Turns on and off automatic guessing by the bot.

## dice.js
A dice-rolling game utilizing channel points

### Installation
1. **IMPORTANT** This module uses custom SQL scripts and so it requires that you are using the H2 datastore. This has been the default since v3.8.0.0 (April 1, 2023) but if your bot is older you will probably need to switch to it.
    * Shut down the bot
    * BACK UP ALL OF THE BOT FILES JUST IN CASE
    * Open botlogin.txt
    * Look for a line starting with `datastore=`
    * Change this to `datastore=h2store2`
    * Save the file
    * Start the bot
    * It will then migrate the data, and should show progress in the command window

1. Put dice.js in the PhantomBot/scripts directory somewhere
1. In the dashboard under Loyalty > Channel Points, make sure they are enabled
1. Add a Redeemable (under the Redeemables tab) with the default settings
1. Add a Reward (under the Rewards tab)
    * Choose the redeemable created in the previous step
    * Enter this for the response: `(command dice roll (cpdisplayname) (cpredeemableid) (cpredemptionid))`

### Commands

* !dice

    Prints basic usage info for users

* !dice stats `username`

    Prints overall roll stats for the user specified or current user if none provided

* !dice message `number` `message`

    Adds the `message` text as a custom message that will be printed when `number` is rolled

* !dice setminroll `number`

    Sets the minimum roll

* !dice setmaxroll `number`

    Sets the maximum roll

* !dicestats

    Prints daily roll stats based on the system time

By default, all viewers can use `!dice` and `!dicestats`. Only the streamer can use `setminroll` and `setmaxroll`. Any mod can use `message`. These permissions can be customized in the dashboard if desired.

## msu-switcher.js
Creates channel point rewards that queue MSU pack changes for the Legend of Zelda: A Link to the Past Randomizer's built-in multi-pack switching ability.

Required setup: all desired MSU packs should be combined into one pack. The first one can use the same names, the rest should be renamed in bands of 100. E.g.:

```
alttp_msu-1.pcm
alttp_msu-2.pcm
...
alttp_msu-60.pcm
alttp_msu-101.pcm
alttp_msu-102.pcm
...
alttp_msu-160.pcm
alttp_msu-201.pcm
alttp_msu-202.pcm
...
alttp_msu-260.pcm
```

Finally, it must NOT be a race rom, or it won't work.

### Installation and setup
1. Copy `msu-switcher.js` to `PhantomBot/scripts/custom` and load or restart the bot.
1. Enable PhantomBot's channel point handler and EventSub connection. Authorize the broadcaster account for channel point reward management, including the `channel:manage:redemptions` scope; Twitch must allow the channel to create channel point rewards. The bot must manage rewards created by its own Twitch application.
1. Configure `DEFAULT_MSU_ADDRESS` in the script for the reachable SNES WebSocket server; the current default is `192.168.1.19:23074`. Use a non-race ROM with MSU multi-pack support.
1. As a bot admin, configure and set up rewards, for example:

  ```text
  !msuswitch cost 500
  !msuswitch cooldown 60
  !msuswitch increase 25
  !msuswitch setup LoZ Remade, Super Mario Galaxy
  ```

  Cost and cooldown must be positive integers; increase may be zero. Cooldown is in seconds. Setup accepts one to five distinct, comma-separated names and saves them to `addons/msuswitcher.txt`, one pack per line. Alternatively, prepare that file and run `!msuswitch setup` without names. Names must be nonempty and fit in a 45-character reward title including `MSU: `.

### Commands and behavior
* `!msuswitch list` shows the settings and indexed slots, costs, and enabled status.
* `!msuswitch resetcosts` clears accumulated increases on all slots, including disabled ones; it does not change the configured increase.
* `!msuswitch teardown` disables the managed rewards without deleting them.
* `!msuswitch <index> [address]` queues a direct switch, optionally using another server address.

Slots are numbered from 0 to 4 in file/setup order and must match the device's pack indices. Reward IDs and accumulated increases belong to slot indices, so reordering or renaming packs reuses the existing slot's reward and cost. Setup reuses existing IDs and disables unused slots.

Each successful redemption queue increases only that slot's cost by the configured amount; a failed queue does not increase it. The shared cooldown starts before the queue attempt, including if it fails. Other rewards are paused during the cooldown, and cooldown and pending reward updates are persisted and reconciled when the script starts again. A queued switch takes effect only at a music transition on a non-race ROM, not necessarily immediately.

Check bot logs for connection, Twitch API, or reward update errors. Failed queue attempts are cancelled; after a queue succeeds, an error updating the redemption may require manual status review. Setup or teardown can partially update rewards if an API call fails: inspect the managed rewards and logs, correct the problem, and retry the command. Pending cost, cooldown, and pause updates are retried by the script.
