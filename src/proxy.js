require("dotenv").config({ quiet: true })

if (!process.env.HYPIXEL_API_KEY) {
    formatter.log("API key not found. Please follow these directions:\n\nVisit https://developer.hypixel.net/dashboard/apps and file a request to create an application for a long-term API key.\nYou can make up anything you want e.g. a discord stat bot (but do not mention this application as it is not allowed).\n\nIn the working directory create a file called '.env'.\nIn this file type: HYPIXEL_API_KEY=replace_this_part_with_your_key")
    process.exit()
}

const fs = require("fs")
const yaml = require("yaml")
const config = yaml.parse(fs.readFileSync("./config.yml", "utf8"))

const mc = require("minecraft-protocol")

const formatter = require("./formatter.js")

class HyProxy {
    constructor() {
        this.server = mc.createServer({
            "online-mode": true,
            port: 25565,
            version: config.version,
            motd: "github.com/danielwzyang",
        })

        this.server.on("login", (client) => {
            this.client = client
            this.handleLogin()
        })

        this.server.on("error", (err) => formatter.log(`Proxy server error: ${err}`))

        formatter.log("Proxy server started.")

        this.statCache = new Map()

        this.filterList = new Set(config.filter_list.filter(Boolean).map(e => e.toLowerCase()))

        this.guildList = new Set(config.guild_list.filter(Boolean).map(e => e.toLowerCase()))

        config.tag = config.tag?.trim() || ""
    }

    handleLogin() {
        formatter.log(`Client connected to proxy: ${this.client.username}`)

        this.pingInterval = setInterval(() => {
            if (config.ping_alerts)
                this.pingTarget()
        }, config.ping_interval)

        this.target = mc.createClient({
            host: "mc.hypixel.net",
            port: 25565,
            username: this.client.username,
            uuid: this.client.profile.id,
            auth: "microsoft",
            version: config.version,
            profile: this.client.profile,
            profilesFolder: config.cache_folder
        })

        this.target.on("connect", () => formatter.log(`Client connected to target: ${this.target.username}`))

        this.client.on("packet", (data, meta) => {

            if (meta.name === "chat" && data.message)
                if (data.message.startsWith("/") && this.handleCommand(data.message))
                    // don't forward command to server
                    return

            if (this.target.state === meta.state) {
                try {
                    this.target.write(meta.name, data)
                } catch (err) {
                    formatter.log(`Error forwarding client to server packet ${meta.name}: ${err}`)
                }
            }
        })

        this.target.on("packet", (data, meta) => {
            if (this.client.state === meta.state) {
                try {
                    this.client.write(meta.name, data)
                } catch (err) {
                    formatter.log(`Error forwarding server to client packet ${meta.name}: ${err}`)
                }
            }
        })

        this.client.on("error", (err) => {
            formatter.log(`Client error: ${err}`)
            this.target.end()
        })

        this.target.on("error", (err) => {
            formatter.log(`Target error: ${err}`)
            this.client.end()
        })

        this.client.on("end", () => {
            formatter.log(`Client disconnected: ${this.client.username}`)
            if (this.pingInterval) clearInterval(this.pingInterval)
            this.target.end()
        })

        this.target.on("end", () => {
            formatter.log(`Disconnected from target server: ${this.client.username}`)
            if (this.pingInterval) clearInterval(this.pingInterval)
            this.client.end()
        })

        this.target.on("chat", (packet) => {
            this.handleChatPacket(packet)
        })
    }

    handleChatPacket(packet) {
        try {
            const rawMessage = formatter.extractText(JSON.parse(packet.message))

            // /who was called
            if (rawMessage.startsWith("ONLINE: ")) {
                const players = rawMessage.replace("ONLINE: ", "").split(", ")

                let delay = 0

                players.forEach((name) => {
                    if ((config.filter_self && name === this.client.username) || this.filterList.has(name.toLowerCase())) return

                    setTimeout(() => this.statcheck({ name, fromSlashWho: true }), delay)

                    delay += config.check_delay
                })
            }

            // bedwars game has started
            if (rawMessage.trim() === "to access powerful upgrades.") {
                if (config.auto_who)
                    this.target.write("chat", { message: "/who" })

                this.statCache.clear()
            }

            // bedwars game has ended
            if (rawMessage.trim().startsWith("1st Killer - "))
                if (config.slumber_alerts)
                    this.slumberAlert()
        } catch (err) {
            formatter.log(`Error processing chat packet: ${err}`)
        }
    }

    handleCommand(command) {
        // statcheck command
        let prefix = `/${config.commands.statcheck}`
        if (command.startsWith(prefix)) {
            const args = command.slice(prefix.length).trim().split(" ").filter(Boolean)

            if (args.length == 0) {
                this.proxyChat("§cPlease provide at least one name to statcheck.")
                return true
            }

            args.forEach((name, i) => {
                setTimeout(() => {
                    this.statcheck({ name })
                }, config.check_delay * i)
            })

            return true
        }

        // filter command
        prefix = `/${config.commands.stat_filter}`
        if (command.startsWith(prefix)) {
            const args = command.slice(prefix.length).trim().split(" ").filter(Boolean)

            if (args.length == 0) {
                this.proxyChat("§cPlease provide at least one username to filter.")
                return true
            }

            args.forEach((name) => {
                this.filterList.add(name.toLowerCase())
                this.proxyChat(`§a${name} §fadded to filter.`)
            })

            return true
        }

        // update_config command 
        prefix = `/${config.commands.update_config}`
        if (command.startsWith(prefix)) {
            const args = command.slice(prefix.length).trim().split(" ").filter(Boolean)

            if (args.length < 2) {
                this.proxyChat("§cPlease provide a config setting and a new value for it.")
                return true
            }

            const [keyPath, ...tempValue] = args
            const keys = keyPath.split(".")
            const value = tempValue.join(" ")

            let dummy = config

            // recursively check if path is valid
            for (let i = 0; i < keys.length - 1; i++) {
                if (!(keys[i] in dummy)) {
                    this.proxyChat(`§cInvalid config path: ${keys[i]} not found.`)
                    return true
                }

                dummy = dummy[keys[i]]
            }

            const lastKey = keys[keys.length - 1]
            if (!(lastKey in dummy)) {
                this.proxyChat(`§cInvalid config key: ${lastKey}.`)
                return true
            }

            const originalType = typeof dummy[lastKey]

            let newValue
            if (originalType === "number") {
                newValue = Number(value)
                if (isNaN(newValue)) {
                    this.proxyChat(`§c${keyPath} must be a number value.`)
                    return true
                }
            } else if (originalType === "boolean") {
                if (value === "true") newValue = true
                else if (value === "false") newValue = false
                else {
                    this.proxyChat(`§c${keyPath} must be a boolean value.`)
                    return true
                }
            } else if (originalType === "string") {
                newValue = value
            } else {
                this.proxyChat(`§c${keyPath} is an object.`)
                return true
            }

            dummy[lastKey] = newValue

            this.proxyChat(`§fUpdated in-memory config: ${keyPath} = ${newValue}.`)

            return true
        }

        return false
    }

    // send server side messages
    proxyChat(message) {
        formatter.log(`<< ${message}`)
        this.client.write("chat", {
            message: JSON.stringify({
                text: `§7${config.show_tag ? `${config.tag_prefix}[${config.tag}] ` : ""}${message}`,
                color: "white",
            }),
            position: 1,
        })
    }

    statcheck({ name, fromSlashWho = false }) {
        this.getMojangUUID(name).then(data => {
            if (!data) return this.proxyChat(`§f${name}: §cNo user found`)

            const { uuid, username } = data

            if (this.statCache.has(username)) {
                const { msg, isThreat } = this.statCache.get(username)

                if (!(fromSlashWho && config.threats_only && !isThreat))
                    this.proxyChat(msg)

                return
            }

            this.getStats(uuid).then(stats => {
                if (!stats) return this.proxyChat(`${config.name_prefix}${username}: §cNo stats found`)

                const msg = formatter.formatStatsMessage(username, stats, config.fkdr_benchmarks)

                const isThreat = Number(stats.fkdr) >= config.threat_benchmarks.fkdr || Number(stats.stars) >= config.threat_benchmarks.stars ||
                    this.guildList.has(stats.guild.toLowerCase())

                this.statCache.set(username, { msg, isThreat })

                // only ignore non threats if the statcheck comes from /who and config.threats_only is true
                if (!(fromSlashWho && config.threats_only && !isThreat))
                    this.proxyChat(msg)
            })
        })
    }

    pingTarget() {
        mc.ping({ host: "mc.hypixel.net", port: 25565 }, (err, res) => {
            if (err) return

            const ping = Math.round(res.latency)
            if (ping >= config.ping_benchmarks.high)
                return this.proxyChat(`§cHigh ping: ${ping}ms`)
            if (ping >= config.ping_benchmarks.medium)
                return this.proxyChat(`§eMedium Ping: ${ping}ms`)
        })
    }

    async getMojangUUID(username) {
        try {
            const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`)
            if (!response.ok) return null
            const data = await response.json()
            return { uuid: data.id, username: data.name }
        } catch (err) {
            this.log(err)
            return null
        }
    }

    async getStats(uuid) {
        try {
            const response = await fetch(`https://api.hypixel.net/v2/player?key=${process.env.HYPIXEL_API_KEY}&uuid=${uuid}`)
            if (!response.ok) return null
            const data = await response.json()
            if (!data.success || !data.player) {
                this.log(`Error fetching API: ${data.cause}`)
                return null
            }

            const bw = data.player.stats?.Bedwars
            if (!bw) return null

            const res = {}

            res.stars = data.player.achievements.bedwars_level || 0
            const finalKills = bw.final_kills_bedwars || 0
            const finalDeaths = bw.final_deaths_bedwars || 1
            res.fkdr = (finalKills / finalDeaths).toFixed(2)

            const plusplus = data.player.monthlyPackageRank && data.player.monthlyPackageRank === "SUPERSTAR"
            res.rank = plusplus ? "MVP_PLUS_PLUS" : (data.player.packageRank || data.player.newPackageRank || "NONE")

            const items = bw.slumber?.quest?.item || {}

            res.slumber = {
                "Bed Sheet": items.slumber_item_bed_sheets || 0,
                "Ender Dust": items.slumber_item_ender_dust || 0,
                "Iron Nugget": items.slumber_item_iron_nugget || 0,
                "Silver Coin": items.slumber_item_silver_coins || 0,
                "Dreamer's Soul Fragment": items.slumber_item_soul || 0,
                "Comfy Pillow": items.slumber_item_comfy_pillow || 0,
                "Token of Ferocity": items.slumber_item_token_of_ferocity || 0,
                "Spare Wool Cable": items.slumber_item_cable || 0,
                "Gold Bar": items.slumber_item_gold_bar || 0,
                "Diamond Fragment": items.slumber_item_diamond_fragment || 0,
                "Emerald Shard": items.slumber_item_emerald_shard || 0,
                "Nether Star": items.slumber_item_nether_star || 0,
            }

            const guild = await this.getGuild(uuid)

            res.guild = guild || "No Guild"

            return res
        } catch (err) {
            this.log(err)
            return null
        }
    }

    async getGuild(uuid) {
        try {
            const response = await fetch(`https://api.hypixel.net/v2/guild?key=${process.env.HYPIXEL_API_KEY}&player=${uuid}`)
            if (!response.ok) return null
            const data = await response.json()
            if (!data.success) {
                this.log(`Error fetching API: ${data.cause}`)
                return null
            }

            if (!data.guild) return null

            return data.guild.name
        } catch (err) {
            this.log(err)
            return null
        }
    }

    printSlumber(stats) {
        if (!stats) return this.proxyChat(`§cError fetching Slumber Hotel stats.`)

        const items = []

        for (let item in stats.slumber)
            if (stats.slumber[item] >= config.slumber_alert_limit)
                items.push(`${item} (${stats.slumber[item]})`)

        if (items.length > 0)
            setTimeout(() => this.proxyChat(`§aSlumber Alert: §f${items.join(", ")}`), config.slumber_alert_delay)
    }

    slumberAlert() {
        if (this.statCache.has(this.client.username)) return this.printSlumber(this.statCache.get(this.client.username))

        this.getStats(this.client.profile.id).then(stats => { this.printSlumber(stats) })
    }
}

new HyProxy()