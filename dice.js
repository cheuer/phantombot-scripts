/*
 * Copyright (C) 2023 cheuer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

( function() {
    let tableName = 'phantombot_diceRolls',
        minRoll = $.getSetIniDbNumber('diceSettings', 'minRoll', 1),
        maxRoll = $.getSetIniDbNumber('diceSettings', 'maxRoll', 100),
        messages = JSON.parse($.getSetIniDbString('diceSettings', 'messages', '{}'));
    
    $.consoleLn('Loaded dice messages: ' + JSON.stringify(messages));
    // $.sql('DROP TABLE IF EXISTS dicerolls', []);
    $.sql('CREATE TABLE IF NOT EXISTS ' + tableName + ' ( "roll" INTEGER NOT NULL, "user" TEXT NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL );', []);

    function rollDice( min, max ) {
        return Math.floor( Math.random() * ( max - min + 1 ) ) + min;
    }

    $.bind( 'command', function( event ) {
        let command = event.getCommand(),
            sender = event.getSender(),
            username = $.usernameResolveIgnoreEx(sender),
            arguments = event.getArguments(),
            args = event.getArgs(),
            action = args[0]
            actionArg1 = args[1],
            actionArg2 = args[2],
            actionArg3 = args[3];

        if(command.equalsIgnoreCase('dice')){
            if(!action){
                $.say('Use the channel point redemption to roll the dice, or try one of these commands: !dicestats !dice stats');
                return;
            }

            if(action.equalsIgnoreCase('roll')){
                if(!actionArg1 || !actionArg2 || !actionArg3){
                    $.say('This can only be called from the channel points handler');
                    return;
                }
                let user = actionArg1,
                    redeemableId = actionArg2,
                    redemptionId = actionArg3,
                    roll = rollDice( minRoll, maxRoll ),
                    message = '';

                $.sql('INSERT INTO ' + tableName + '("roll", "user", "timestamp") VALUES( ?, ?, CURRENT_TIMESTAMP);', [ roll, user.toLowerCase() ]);

                message += user + ' rolled ' + roll;
                if(messages[roll]){
                    message += ' ' + messages[roll];
                }

                $.say(message);
                $.channelpoints.updateRedemptionStatusFulfilled(redeemableId, redemptionId);
                return;

            } else if(action.equalsIgnoreCase('stats')){
                if(actionArg1){
                    username = $.usernameResolveIgnoreEx(actionArg1);
                    sender = username.toLowerCase();
                }
                let result = $.sql( 'SELECT COUNT("roll") FILTER(WHERE "roll" = ' + minRoll + '), COUNT("roll") FILTER(WHERE "roll" = ' + maxRoll + '), COUNT("roll") FILTER(WHERE "roll" = 69), COUNT("roll"), AVG("roll"), MEDIAN("roll"), STDDEV_POP("roll"), MODE("roll") FROM ' + tableName + ' WHERE "user" = ?;', [sender]),
                    // dailyresult = $.sql( 'SELECT COUNT("roll") FILTER(WHERE "roll" = ' + minRoll + '), COUNT("roll") FILTER(WHERE "roll" = ' + maxRoll + '), COUNT("roll") FILTER(WHERE "roll" = 69), COUNT("roll"), AVG("roll") FROM ' + tableName + ' WHERE "user" = ? AND datetime((timestamp/1000), "unixepoch", "localtime") >= date("now", "localtime");', [sender] )
                    min = result[0][0],
                    max = result[0][1],
                    nice = result[0][2],
                    total = result[0][3],
                    avg = result[0][4],
                    med = result[0][5],
                    stddev = result[0][6],
                    mode = result[0][7];
                    $.say('Stats for ' + username + ': ' + minRoll + 's: ' + min + '. ' + maxRoll + 's: ' + max + '. Nice rolls: ' + nice + '. Average: ' + parseFloat(avg).toFixed(2) + ', median: ' + med + ', mode: ' + mode + ', stddev: ' + parseFloat(stddev).toFixed(2) + '. Total rolls: ' + total + '.');
                    return;

            } else if(action.equalsIgnoreCase('message')){
                if(!actionArg1){
                    $.say('Usage: !dice message [number] [message]');
                    return;
                }

                if(!actionArg2){
                    delete messages[actionArg1];
                } else{
                    argsString = args.slice(2).join(' ');
                    messages[actionArg1] = argsString;
                }

                $.setIniDbString('diceSettings', 'messages', JSON.stringify(messages));
                $.consoleLn('Saved dice messages: ' + JSON.stringify(messages));
                $.say('Dice messages updated');

            } else if(action.equalsIgnoreCase('setminroll')){
                if(!actionArg1){
                    $.say('Usage: !dice setminroll [number]. Current min: ' + minRoll);
                    return;
                }
                $.setIniDbNumber('diceSettings', 'minRoll', actionArg1);
                $.say('Min roll set to ' + parseInt(actionArg1));
                
            } else if(action.equalsIgnoreCase('setmaxroll')){
                if(!actionArg1){
                    $.say('Usage: !dice setmaxroll [number]. Current max: ' + maxRoll);
                    return;
                }
                $.setIniDbNumber('diceSettings', 'maxRoll', actionArg1);
                $.say('Max roll set to ' + parseInt(actionArg1));
            }
         
        } else if(command.equalsIgnoreCase('dicestats')){
            let result = $.sql( 'SELECT min("roll"), max("roll"), COUNT("roll") FILTER(WHERE "roll" = 69), COUNT("roll"), MEDIAN("roll"), STDDEV_POP("roll"), MODE("roll"), AVG("roll")  FROM ' + tableName + ' WHERE "timestamp" >= CURRENT_DATE;', []),
                min = result[0][0],
                max = result[0][1],
                nice = result[0][2],
                total = result[0][3],
                med = result[0][4],
                stddev = result[0][5],
                mode = result[0][6],
                avg = result[0][7],
                message = 'There have been ' + total + ' dice rolls today, ranging from ' + min + ' to ' + max + '. Average: ' + parseFloat(avg).toFixed(2) + ', median: ' + med + ', mode: ' + mode + ', stddev: ' + parseFloat(stddev).toFixed(2) + '.';

            if(total == 0){
                $.say('No dice have been rolled yet today!');
                return;
            }
            if(nice > 0){
                message += ' There were also ' + nice + ' nice rolls';
                
                if(messages[69]){
                    message += ' ' + messages[69];
                }
            }
            $.say(message);
        }

    } );

    $.bind( 'initReady', function() {
        $.registerChatCommand('./custom/dice.js', 'dice', $.PERMISSION.Viewer);
        $.registerChatCommand('./custom/dice.js', 'dicestats', $.PERMISSION.Viewer);
        $.registerChatSubcommand('dice', 'roll', $.PERMISSION.Admin);
        $.registerChatSubcommand('dice', 'stats', $.PERMISSION.Viewer);
        $.registerChatSubcommand('dice', 'message', $.PERMISSION.Mod);
        $.registerChatSubcommand('dice', 'setminroll', $.PERMISSION.Admin);
        $.registerChatSubcommand('dice', 'setmaxroll', $.PERMISSION.Admin);
    } );

} )();
