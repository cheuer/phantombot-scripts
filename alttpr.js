/*
 * Copyright (C) 2019 cheuer
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
    var isRunning = false,
        timer;

    function start( message ) {
        if( isRunning ) {
            return;
        } else {
            isRunning = true;
        }

        $.say( message );

        var timerLength = $.inidb.GetInteger( 'alttpr_settings', '', 'timer' )
        if( timerLength > 0 ) {
            timer = setTimeout( function() { end(); }, timerLength * 1000 );
        }
    }

    function end() {
        isRunning = false;
        $.say( 'Time\'s up! No more guessing!' );

        var guesses = $.inidb.GetKeyList( 'alttpr_guesses', '' );
        for( i = 0; i < guesses.length; i++ ) {
            $.consoleLn( '  ' + guesses[i] + ': ' + $.inidb.GetInteger( 'alttpr_guesses', '', guesses[i] ) );
        }
    }

    function winner( value, min, max ) {
        value = parseInt( value );

        if( isRunning ) {
            isRunning = false;
        }

        var dbGuesses = $.inidb.GetKeyList( 'alttpr_guesses', '' ),
            guesses = [],
            winners = [];
        for( i = 0; i < dbGuesses.length; i++ ) {
            var guess = $.inidb.GetInteger( 'alttpr_guesses', '', dbGuesses[i] );
            $.consoleLn( '  ' + dbGuesses[i] + ': ' + guess );
            guesses.push( { name: dbGuesses[i], value: guess } );
            if( value === guess ) {
                winners.push( dbGuesses[i] );
            }
        }

        var adj = 1,
            winning_guess = value;
        while( winners.length == 0 && ( ( value - adj ) >= min || ( value + adj ) <= max ) ) {
            $.consoleLn( 'adjustment: ' + adj );
            if( ( value - adj ) >= min ) {
                for( i = 0; i < guesses.length; i++ ) {
                    if( guesses[i].value === value - adj ) {
                        winning_guess = value - adj;
                        winners.push( guesses[i].name );
                    }
                }
                if( winners.length > 0 ) {
                    break;
                }
            }

            if( ( value + adj ) <= max ) {
                for( i = 0; i < guesses.length; i++ ) {
                    if( guesses[i].value === value + adj ) {
                        winning_guess = value + adj;
                        winners.push( guesses[i].name );
                    }
                }
                if( winners.length > 0 ) {
                    break;
                }
            }

            adj++;
        }

        var message = 'The correct answer was ' + value + '!';

        if( winners.length > 0 ) {
            if( winning_guess == value ) {
                message += ' The winner(s): ';
            } else {
                message += ' The closest guess was ' + winning_guess + ' from: ';
            }
            for( i = 0; i < winners.length; i++ ) {
                if( i > 0 ) {
                    message += ', ';
                }
                message += winners[i];

                var score = $.inidb.GetInteger( 'alttpr_winners', '', winners[i] );
                if( isNaN( score ) ) {
                    $.inidb.SetInteger( 'alttpr_winners', '', winners[i], 1 );
                } else {
                    $.inidb.SetInteger( 'alttpr_winners', '', winners[i], score + 1 );
                }
            }
        } else {
            message += ' Nobody guessed!';
        }

        $.say( message );

        print_leaderboard();

        $.inidb.RemoveFile( 'alttpr_guesses' );
    }

    function print_leaderboard() {
        var message = 'Leaderboard: ',
            leaderboard = $.inidb.GetKeyList( 'alttpr_winners', '' ),
            sortedLeaderboard = [];

        for( i = 0; i < leaderboard.length; i++ ) {
            sortedLeaderboard.push( { name: leaderboard[i], value: $.inidb.GetInteger( 'alttpr_winners', '', leaderboard[i] ) } );
        }

        sortedLeaderboard.sort( function( a, b ) { return b.value - a.value } );
        for( i = 0; i < sortedLeaderboard.length; i++ ) {
            if( i > 0 ) {
                message += ', ';
            }
            message += sortedLeaderboard[i].name + ': ' + sortedLeaderboard[i].value;
        }

        $.say( message );
    }

    function random_guess( min, max ) {
        if( false == $.getIniDbBoolean( 'alttpr_settings', 'guess' ) ) {
            return;
        }

        var guess = Math.floor( Math.random() * ( max - min + 1 ) ) + min;
        $.say( 'My guess is ' + guess );
        $.inidb.SetInteger( 'alttpr_guesses', '', $.botName, guess );
    }

    $.bind( 'command', function( event ) {
        var command = event.getCommand();
        var sender = event.getSender();
        var arguments = event.getArguments();
        var args = event.getArgs();

        switch( String( args[0] ) ) {
            case 'help':
                $.say( 'Usage: [start], (number), reset, cancel, stop, set (name) (number), print, timer [number], guess, help' );
                break;

            case 'reset':
                $.inidb.RemoveFile( 'alttpr_winners' );
                $.say( 'Leaderboard reset!' );
                break;

            case 'cancel':
                isRunning = false;
                clearTimeout( timer );
                $.inidb.RemoveFile( 'alttpr_guesses' );
                $.say( 'Guessing game canceled' );
                break;

            case 'stop':
                clearTimeout( timer );
                end();
                break;

            case 'set':
                var name = String( args[1] ).toLowerCase(),
                    wins = args[2];
                if( wins == 0 ) {
                    $.inidb.RemoveKey( 'alttpr_winners', '', name );
                } else {
                    $.inidb.SetInteger( 'alttpr_winners', '', name, wins );
                }
                $.say( 'Setting wins for ' + name + ' to ' + wins );
                print_leaderboard();
                break;

            case 'print':
                print_leaderboard();
                break;

            case 'timer':
                var timerLength = $.inidb.GetInteger( 'alttpr_settings', '', 'timer' );
                $.consoleLn( 'Current timer setting: ' + timerLength );
                if( args[1] !== undefined ) {
                    timerLength = args[1];
                    $.inidb.SetInteger( 'alttpr_settings', '', 'timer', timerLength );
                }
                
                if( timerLength > 0 ) {
                    $.say( 'The timer is ' + timerLength + ' seconds.' );
                } else {
                    $.say( 'The timer is disabled.' );
                }
                break;

            case 'guess':
                var setting = $.getIniDbBoolean( 'alttpr_settings', 'guess', false );
                $.consoleLn( typeof setting );
                if( false == setting ){
                    $.say( 'Bot guessing enabled' );
                } else {
                    $.say( 'Bot guessing disabled' );
                }
                $.setIniDbBoolean( 'alttpr_settings', 'guess', !setting );
                break;

            case 'start':
            default:
				if( args[0] !== undefined && args[0] != 'start' && isNaN( args[0] ) ) {
					return;
                }

                if( command.equalsIgnoreCase( 'bk' ) ) {
                    if( isNaN( args[0] ) ) {
                        start( 'Guess where the big key is hiding in Ganon\'s tower! Type a number in chat between 1 and 22.' );
                        random_guess( 1, 22 );
                    } else {
                        winner( args[0], 1, 22 );
                    }
                }

                if( command.equalsIgnoreCase( 'bl' ) ) {
                    if( isNaN( args[0] ) ) {
                        start( 'Guess how many "blue ball" attacks Agahnim will throw at us! Type a number in chat between 0 and 15.' );
                        random_guess( 0, 15 );
                    } else {
                        winner( args[0], 0, 15 );
                    }
                }
        }
    } );

    $.bind( 'ircChannelMessage', function( event ) {
        if( !isRunning ) {
            return;
        }

        var message = event.getMessage();
        var sender = event.getSender();
        var guess = parseInt( message );

        if( !isNaN( guess ) ) {
            $.inidb.SetInteger( 'alttpr_guesses', '', sender, guess );
            $.consoleLn( 'saved guess for ' + sender + ' : ' + $.inidb.GetInteger( 'alttpr_guesses', '', sender ) + '. ' );
        }
    } );

    $.bind( 'initReady', function() {
        $.registerChatCommand( './custom/alttpr.js', 'bk', 2 );
        $.registerChatCommand( './custom/alttpr.js', 'bl', 2 );
    } );

} )();
