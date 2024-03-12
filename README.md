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
