require("dotenv").config()

if (!process.env.HYPIXEL_API_KEY) {
    console.error("API key not found. Please follow these directions:\n\nVisit https://developer.hypixel.net/dashboard/apps and file a request to create an application for a long-term API key.\nYou can make up anything you want e.g. a discord stat bot (but do not mention this application as it is not allowed).\n\nIn the working directory create a file called '.env'.\nIn this file type: HYPIXEL_API_KEY=replace_this_part_with_your_key")
    process.exit()
}

const fs = require("fs")
const config = require("yaml").parse(fs.readFileSync("./config.yml", "utf8"))

const mc = require("minecraft-protocol")

class HyProxy {
    constructor() {
        this.server = mc.createServer({
            "online-mode": true,
            port: 25565,
            version: config.version,
        })

        this.server.on("login", (client) => {
            this.client = client
            this.handleLogin()
        })

        this.server.on("error", (err) => console.error("Proxy server error:", err))

        this.log("Proxy server started.")

        this.statCache = new Map()

        this.tag = config.tag?.trim() || ""
        if (this.tag.length > 0)
            this.tag = `${config.tag_color}[${this.tag}] `
    }

    log(message) {
        console.log(`${new Date().toLocaleTimeString()}: ${message}`)
    }

    handleLogin() {
        this.log(`Client connected: ${this.client.username}`)

        this.target = mc.createClient({
            host: "mc.hypixel.net",
            port: 25565,
            username: this.client.username,
            uuid: this.client.id,
            auth: "microsoft",
            version: config.version,
            profile: this.client.profile,
            profilesFolder: config.cache_folder
        })

        this.client.on("packet", (data, meta) => {
            if (meta.name === "chat" && data.message)
                if (data.message.startsWith("/") && this.handleCommand(data.message))
                    // don't forward command to server
                    return

            if (this.target.state === meta.state) {
                try {
                    this.target.write(meta.name, data)
                } catch (err) {
                    console.error(`Error forwarding client to server packet ${meta.name}:`, err)
                }
            }
        })

        this.target.on("packet", (data, meta) => {
            if (this.client.state === meta.state) {
                try {
                    this.client.write(meta.name, data)
                } catch (err) {
                    console.error(`Error forwarding server to client packet ${meta.name}:`, err)
                }
            }
        })

        this.client.on("error", (err) => {
            console.error("Client error:", err)
            this.target.end()
        })

        this.target.on("error", (err) => {
            console.error("this.target error:", err)
            client.end()
        })

        this.client.on("end", () => {
            this.log(`Client disconnected: ${this.client.username}`)
            this.target.end()
        })

        this.target.on("end", () => {
            this.log(`Disconnected from target server: ${this.client.username}`)
            this.client.end()
        })

        this.target.on("chat", (packet) => {
            this.handleChatPacket(packet)
        })
    }

    handleChatPacket(packet) {
        try {
            const rawMessage = this.extractText(JSON.parse(packet.message))

            // /who was called
            if (rawMessage.startsWith("ONLINE: ")) {
                this.log("Beginning statchecks.")
                const players = rawMessage.replace("ONLINE: ", "").split(", ")

                let delay = 0

                players.forEach((name) => {
                    if (config.ignore_self && name === this.client.username) return

                    setTimeout(() => this.statcheck(name), delay)

                    delay += config.check_delay
                })
            }

            // bedwars game has started
            if (config.auto_who && rawMessage.trim() === "to access powerful upgrades.")
                this.target.write("chat", { message: "/who" })
        } catch (e) {
            console.error("Error processing chat packet:", e)
        }
    }

    handleCommand(command) {
        // statcheck command
        let prefix = `/${config.commands.statcheck}`
        if (command.startsWith(prefix)) {
            this.log("Statcheck command was called.")

            const args = command.slice(prefix.length).trim().split(/\s+/).filter(Boolean)

            if (args.length == 0) {
                this.proxyChat("§cPlease provide at least one name to statcheck.")
                return true
            }

            args.forEach((name, i) => {
                setTimeout(() => {
                    this.statcheck(name)
                }, config.check_delay * i)
            })

            return true
        }

        return false
    }

    // send server side messages
    proxyChat(message) {
        this.log(`<< ${message}`)
        this.client.write("chat", {
            message: JSON.stringify({
                text: `§7${this.tag}${message}`,
                color: "white",
            }),
            position: 1,
        })
    }

    // extract a string from the message json that's given
    extractText(component) {
        // this recursion is probably overkill
        let res = ""

        if (component.text) res += component.text

        if (component.extra)
            component.extra.forEach(part => res += this.extractText(part))

        return res
    }

    formatStatsMessage(username, stats) {
        return `${this.getRankColor(stats.rank)}${username}: ${this.getColoredStar(stats.stars)} §7| ${this.getColoredFKDR(stats.fkdr)} FKDR`
    }

    getRankColor(rank) {
        switch (rank) {
            case "MVP_PLUS_PLUS":
                return "§6"
            case "MVP_PLUS":
            case "MVP":
                return "§b"
            case "VIP_PLUS":
            case "VIP":
                return "§a"
            default:
                return "§7"
        }
    }

    getColoredStar(starLevel) {
        const starColors = [
            "§7", // 0-99: gray
            "§f", // 100-199: white
            "§6", // 200-299: gold
            "§b", // 300-399: cyan
            "§2", // 400-499: dark green
            "§3", // 500-599: dark aqua
            "§4", // 600-699: dark red
            "§d", // 700-799: pink
            "§9", // 800-899: blue
            "§5", // 900-999: purple
        ]

        // everything past 1000 is rainbow prestige because i'm too lazy for anything more
        if (starLevel >= 1000) {
            const str = starLevel.toString()
            const rainbow = ["§c", "§6", "§e", "§a", "§d", "§5"] // red, orange, yellow, green, pink, purple

            let colored = `${rainbow[0]}[`

            for (let i = 0; i < str.length; i++)
                colored += `${rainbow[i + 1]}${str[i]}`

            colored += `✫${rainbow[str.length + 1]}]`

            return colored
        }

        return `${starColors[Math.floor(starLevel / 100)]}[${starLevel}✫]`
    }

    getColoredFKDR(fkdr) {
        const fkdrNum = parseFloat(fkdr)

        if (fkdrNum >= config.fkdr_benchmarks.good) return `§c${fkdr}` // red
        if (fkdrNum >= config.fkdr_benchmarks.medium) return `§6${fkdr}` // orange
        if (fkdrNum >= config.fkdr_benchmarks.low) return `§e${fkdr}` // yellow
        return `§7${fkdr}` // gray
    }

    async getMojangUUID(username) {
        try {
            const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`)
            if (!response.ok) return null
            const data = await response.json()
            return { uuid: data.id, username: data.name }
        } catch (err) {
            console.error("fetch error:", err)
            return null
        }
    }

    async getStats(uuid) {
        try {
            const response = await fetch(`https://api.hypixel.net/v2/player?key=${process.env.HYPIXEL_API_KEY}&uuid=${uuid}`)
            if (!response.ok) return null
            const data = await response.json()
            if (!data.success || !data.player) return null

            const bw = data.player.stats?.Bedwars
            if (!bw) return null

            const stars = Math.floor(bw.Experience / 5000)
            const finalKills = bw.final_kills_bedwars || 0
            const finalDeaths = bw.final_deaths_bedwars || 1
            const fkdr = (finalKills / finalDeaths).toFixed(2)

            const plusplus = data.player.monthlyPackageRank && data.player.monthlyPackageRank === "SUPERSTAR"
            const rank = plusplus ? "MVP_PLUS_PLUS" : (data.player.packageRank || data.player.newPackageRank || "NONE")

            return { stars, fkdr, rank }
        } catch (err) {
            console.error("hypixel api error:", err)
            return null
        }
    }

    statcheck(name) {
        this.log(`Statchecking ${name}.`)
        if (this.statCache.has(name)) {
            this.log(`${name} found in cache.`)
            return this.proxyChat(this.statCache.get(name))
        }

        this.getMojangUUID(name).then(data => {
            if (!data) {
                this.log(`UUID for ${name} not found.`)
                return this.proxyChat(`§f${name}: §cNo user found`)
            }

            const { uuid, username } = data

            this.getStats(uuid).then(stats => {
                if (!stats) {
                    this.log(`Stats for ${name} not found.`)
                    return this.proxyChat(`${config.name_color}${username}: §cNo stats found`)
                }

                this.log(`Stats for ${name} found. Adding to cache.`)
                const msg = this.formatStatsMessage(username, stats)
                this.statCache.set(username, msg)

                if (stats.fkdr >= config.ignore_benchmarks.fkdr || stats.stars >= config.ignore_benchmarks.stars)
                    this.proxyChat(msg)
            })
        })
    }
}

new HyProxy()