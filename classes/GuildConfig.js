const deepEquals = require('deep-equal');
const NodeCache = require('node-cache');
const Database = require('./Database');
const database = new Database('guilds');

/**
 * A local cache, to reduce database calls.
 * @type {NodeCache}
 */
const cache = new NodeCache({
    stdTTL: 600, // Cache guilds for 10-20 minutes, depending on the check period.
    useClones: false // Store the original objects, for mutability.
});

// TODO Convert this to a map of class instances.
const SETTINGS = {
    prefix: {
        defaultValue: '!sau|!s',
        setter: (value) => {
            const stripped = value.toLowerCase().trim().split(/[\s|]+/g,).join('|');
            if (!stripped) throw new Error("Can't set an empty command prefix.");
            return stripped;
        }
    }
};

function getSetting(key){
    const setting = key && SETTINGS[key.toLowerCase()]
    if (!setting) throw new Error("There's no such setting.");
    return setting;
}

class GuildConfig {
    static async load(guildId) {
        // Check the cache first.
        const cachedGuild = await cache.get(guildId);
        if (cachedGuild) return cachedGuild;

        // Otherwise, create a new one.
        const document = await database.get(guildId).catch(error => console.error(error));
        return new GuildConfig(document || { _id: guildId });
    }

    constructor({ ...document }) {
        // Store the document.
        this._document = document;

        // Ensure the ID is valid.
        if (!this.id || typeof this.id !== 'string') throw new Error('Guild.id must be a non-empty string.');

        // Make sure there's a config property.
        if (!document.config) document.config = {};

        // Add this to the cache.
        cache.set(this.id, this);
    }

    get id() { return this._document._id; }


    get(key) {
        const { defaultValue, getter } = getSetting(key);
        const value = this._document.config[key] || defaultValue;
        return getter ? getter(value) : value;
    }

    set(key, value) {
        const { setter, getter } = getSetting(key);
        const storedValue = setter ? setter(value) : value;
        if (!deepEquals(storedValue, this._document.config[key])){
            this._document.config[key] = storedValue;
            this.scheduleSave();
        }
        return getter ? getter(storedValue) : storedValue;

    }

    reset(key) {
        const { defaultValue, getter } = getSetting(key);
        if (this._document.config.hasOwnProperty(key)){
            delete this._document.config[key]
            this.scheduleSave();
        }
        return getter ? getter(defaultValue) : defaultValue;
    }

    get commandPrefixes() {
        return this._document.commandPrefixes || ['!sau', '!s'];
    }

    async updateCommandPrefixes(...params) {
        const prefixes = params.map(param => param.trim());

        // Skip the rest, if it's the same as what we already have.
        if (deepEquals(prefixes, this.commandPrefixes)) return;

        // Store the prefix and save.
        this._document.commandPrefixes = prefixes;
        await this.save();
    }

    scheduleSave() {
        // Reset any existing timeout, to reduce database load.
        if (this._nextSaveTimeout) {
            clearTimeout(this._nextSaveTimeout);
            delete this._nextSaveTimeout;
        }
        // Create a new timeout, to save after a short delay.
        this._nextSaveTimeout = setTimeout(() => {
            delete this._nextSaveTimeout;
            this.save();
        }, 1500);
    }

    async save() {
        const updates = await database.set(this._document).catch(error => console.error(error));
        if (updates) this._document._rev = updates.rev;
    }
}

module.exports = GuildConfig;