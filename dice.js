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
    let tableName = 'dicerolls',
        minRoll = $.getSetIniDbNumber('diceSettings', 'minRoll', 1),
        maxRoll = $.getSetIniDbNumber('diceSettings', 'maxRoll', 100)
        minMessage = $.getSetIniDbString('diceSettings', 'minMessage', 'Sadge'),
        maxMessage = $.getSetIniDbString('diceSettings', 'maxMessage', 'POGGERS'),
        niceMessage = $.getSetIniDbString('diceSettings', 'niceMessage', 'DataFace');

        $.sql('CREATE TABLE IF NOT EXISTS ' + tableName + ' ( "roll" INTEGER NOT NULL, "user" TEXT NOT NULL, "timestamp" INTEGER NOT NULL );', []);

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
                $.say('Use the channel point redemption to roll the dice, or try !dicestats or !dice stats');
                return;
            }

            if(action.equalsIgnoreCase('roll')){
                if(!actionArg1){
                    $.say('This can only be called from the channel points handler');
                    return;
                }
                let user = actionArg1,
                    redeemableId = actionArg2,
                    redemptionId = actionArg3,
                    roll = rollDice( minRoll, maxRoll ),
                    message = '';

                $.sql('INSERT INTO ' + tableName + '(roll, user, timestamp) VALUES( ?, ?, ?);', [ roll, user.toLowerCase(), $.systemTime() ]);

                message += user + ' rolled ' + roll;
                if(roll == minRoll){
                    message += ' ' + minMessage;
                }
                if(roll == maxRoll){
                    message += ' ' + maxMessage;
                }
                if(roll == 69){
                    message += ' ' + niceMessage;
                }

                $.say(message);
                $.channelpoints.updateRedemptionStatusFulfilled(redeemableId, redemptionId);
                return;


                // in case I need to parse the timestamp later
                //$.getLocalTimeString('yyyy-mm-dd'), parseInt(num));

            } else if(action.equalsIgnoreCase('stats')){
                if(actionArg1){
                    username = $.usernameResolveIgnoreEx(actionArg1);
                    sender = username.toLowerCase();
                }
                let result = $.sql( 'SELECT COUNT(roll) FILTER(WHERE roll = ' + minRoll + '), COUNT(roll) FILTER(WHERE roll = ' + maxRoll + '), COUNT(roll) FILTER(WHERE roll = 69), COUNT(roll), AVG(roll) FROM dicerolls WHERE user = ?;', [sender]),
                    min = result[0][0],
                    max = result[0][1],
                    nice = result[0][2],
                    total = result[0][3],
                    avg = result[0][4];
                    $.say('Stats for ' + username + ': ' + minRoll + 's: ' + min + '. ' + maxRoll + 's: ' + max + '. Nice rolls: ' + nice + '. Average: ' + parseFloat(avg).toFixed(2) + '. Total rolls: ' + total + '.');
                    return;

            }
         
        } else if(command.equalsIgnoreCase('dicestats')){
            let result = $.sql( 'SELECT min(roll), max(roll), COUNT(roll) FILTER(WHERE roll = 69), COUNT(roll) FROM dicerolls WHERE datetime((timestamp/1000), "unixepoch", "localtime") >= date("now", "localtime");', []),
                min = result[0][0],
                max = result[0][1],
                nice = result[0][2],
                total = result[0][3],
                message = 'There have been ' + total + ' dice rolls today, ranging from ' + min + ' to ' + max + '.';

            if(total == 0){
                $.say('No dice have been rolled yet today!');
                return;
            }
            if(nice > 0){
                message += ' There were also ' + nice + ' nice rolls DataFace';
            }
            $.say(message);
        }

    } );

    $.bind( 'initReady', function() {
        $.registerChatCommand('./custom/dice.js', 'dice', $.PERMISSION.Viewer);
        $.registerChatCommand('./custom/dice.js', 'dicestats', $.PERMISSION.Viewer);
        $.registerChatSubcommand('dice', 'roll', $.PERMISSION.Admin);
        $.registerChatSubcommand('dice', 'stats', $.PERMISSION.Viewer);
    } );

} )();
