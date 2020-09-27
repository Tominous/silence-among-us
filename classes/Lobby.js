const discord = require('../discord-bot/discord-bot');
const Player = require('./Player');
const Room = require('./Room');

/**
 * The valid states of a lobby.
 */
const STATE = {
    INTERMISSION: 'intermission',
    WORKING: 'working',
    MEETING: 'meeting'
};

/**
 * Maps voice channel IDs to lobbies.
 * @type {Map<string, Lobby>}
 */
const lobbies = new Map();

// TODO Store lobbies somewhere outside of memory.

/**
 * @property {string} voiceChannelId - Id of the voice channel associated with the lobby.
 * @property {string} state - Current state of the lobby.
 * @property {Player[]} players - All the current (and past) players.
 */
class Lobby {
    static get STATE() {return STATE;}

    /**
     * Create a new lobby for a channel.
     *
     * @param {string|Discord.VoiceChannel} voiceChannel - Voice channel, or the id of one.
     * @param {string|Discord.GuildChannel} [textChannel] - Guild text channel, or the id of one.
     * @returns {Promise<Lobby>}
     */
    static async start(voiceChannel, textChannel) {
        if (typeof voiceChannel === 'string') {
            // TODO Get the voice channel associated with the ID.
            throw new Error("Starting a channel by ID isn't supported yet.");
        }
        if (typeof textChannel === 'string') {
            // TODO Get the voice channel associated with the ID.
            throw new Error("Starting a channel by ID isn't supported yet.");
        }

        const voiceChannelId = voiceChannel.id;
        const textChannelId = textChannel && textChannel.id;

        const lobby = new Lobby({ voiceChannelId, textChannelId, state: STATE.INTERMISSION });
        lobby._voiceChannel = voiceChannel;
        lobby._textChannel = textChannel;
        lobbies.set(voiceChannelId, lobby);

        // Add players
        await Promise.all(voiceChannel.members.map(member => lobby.connectPlayer(member)));

        lobby.emit("Created");

        // TODO Save to database.

        return lobby;
    }

    /**
     * Find a lobby associated with a channel id.
     *
     * @param {string|Discord.VoiceChannel} voiceChannel - Voice channel, or channel ID.
     * @returns {Promise<Lobby>} - Lobby matching the channel, or null
     */
    static async find(voiceChannel) {
        if (typeof voiceChannel === 'string') voiceChannel = await discord.channels.fetch(voiceChannel);
        if (!voiceChannel) return null;

        // TODO Load from database.

        const lobby = lobbies.get(voiceChannel.id);
        if (lobby) lobby._voiceChannel = voiceChannel;
        return lobby;
    }

    constructor({ voiceChannelId, state, players, room }) {
        if (!voiceChannelId || typeof voiceChannelId !== 'string') throw new Error("Invalid lobby voiceChannelId");
        this.voiceChannelId = voiceChannelId;

        if (!Object.values(STATE).includes(state)) throw new Error("Invalid lobby state");
        this.state = state;

        // Create a map to hold the players.
        this._players = new Map();
        // TODO Add initial players from the constructor.

        // TODO Handle the room properly
        if (room) this.room = new Room(room);
    }

    /**
     * Get the underlying voice channel for the lobby.
     * @returns {Discord.VoiceChannel}
     */
    get voiceChannel() { return this._voiceChannel; }

    get players() { return [...this._players.values()]}

    emit(message) {
        console.log(`Lobby ${this.voiceChannelId}: ${message}`);
    }

    /**
     * Connects or reconnects a GuildMember as a player.
     * @param {Discord.GuildMember} member
     * @param {string} [status] - Status for the player to start with.
     * @returns {Promise<Player>} - The player added/updated.
     */
    async connectPlayer(member, status ) {
        // Ignore bots.
        if (member.user.bot) return null;

        // Load or create a player.
        const playerId = member.id;
        const player = this._players.get(playerId) || new Player(this.voiceChannelId, member, status)
        this._players.set(playerId, player);

        // Update the player's state.
        await this.updatePlayerState(player);

        this.emit(`Connected player ${player.name} (${player.id})`);
        return player;
    }

    async killPlayer(member) {
        const player = this._players.get(member.id)

        // If the player isn't already in the lobby, add them to it.
        if (!player) return this.connectPlayer(member, Player.STATUS.DYING);

        // Otherwise, mark them as dying and update their state.
        player.status = Player.STATUS.DYING;
        return this.updatePlayerState(player);
    }

    async revivePlayer(member) {
        const player = this._players.get(member.id)

        // If the player isn't in the lobby, ignore the request.
        if (!player) return null;

        // Otherwise, mark them as living and update their state.
        player.status = Player.STATUS.LIVING;
        return this.updatePlayerState(player);
    }

    async updatePlayerState(player) {
        switch (this.state) {
            case STATE.INTERMISSION:
                return player.setForIntermission();
            case STATE.WORKING:
                return player.setForWorking();
            case STATE.MEETING:
                return player.setForMeeting();
            default:
                throw new Error("Invalid target state");
        }
    }

    async stop() {
        // Unlink the from the "database".
        lobbies.delete(this.voiceChannelId);

        // Unmute all players.
        await Promise.all(this.players.map(player => player.setMuteDeaf(false, false, "Lobby Stopped")));

        this.emit("Destroyed");
    }

    /**
     * Transition to the new state.
     *
     * @param {string} targetState
     * @returns {Promise<void>}
     */
    async transition(targetState) {
        if (this.state === targetState) throw new Error(`Already in the ${targetState} state`);

        // TODO Get the channel, if not passed in.

        // Handle the transition.
        switch (targetState) {
            case STATE.INTERMISSION:
                this.emit('Transitioning to intermission');
                await Promise.all(this.players.map(player => player.setForIntermission()));
                this.emit('Intermission');
                break;

            case STATE.WORKING:
                this.emit('Transitioning to working');
                // TODO Handle players in correct order.
                await Promise.all(this.players.map(player => player.setForWorking()));
                this.emit('Working');
                break;

            case STATE.MEETING:
                this.emit('Transitioning to meeting');
                // TODO Handle players in correct order.
                await Promise.all(this.players.map(player => player.setForMeeting()));
                this.emit('Meeting');
                break;

            default:
                throw new Error("Invalid target state");
        }

        this.state = targetState;
    }
}

module.exports = Lobby;