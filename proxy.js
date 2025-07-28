require("dotenv").config()

const mc = require("minecraft-protocol")

class HyProxy {
    constructor() {
        this.server = mc.createServer({
            "online-mode": true,
            port: 25565,
            version: "1.8.9"
        })

        this.server.on("login", (client) => this.handleLogin(client))
        this.server.on("error", (err) => console.error("Proxy server error:", err))

        console.log("Proxy server running")

        this.statCache = new Map()
    }

    proxyChat(client, message) {
        console.log(`<< ${message}`)
        client.write("chat", {
            message: JSON.stringify({
                text: `§7[HYPROXY] ${message}`
            }),
        })
    }

    extractText(component) {
        let res = ""

        if (component.text) res += component.text

        // this recursion is probably overkill
        if (component.extra)
            component.extra.forEach(part => res += this.extractText(part))

        return res
    }

    formatStatsMessage(name, stats) {
        return `${name}: ${this.getColoredStar(stats.stars)} §7| ${this.getColoredFKDR(stats.fkdr)} FKDR`
    }

    getColoredStar(starLevel) {
        const starColors = [
            '§7', // 0-99: gray
            '§f', // 100-199: white
            '§6', // 200-299: gold
            '§b', // 300-399: cyan
            '§2', // 400-499: dark green
            '§3', // 500-599: dark aqua
            '§4', // 600-699: dark red
            '§d', // 700-799: pink
            '§9', // 800-899: blue
            '§5', // 900-999: purple
            '§f'  // 1000+: white
        ];

        if (starLevel >= 1000) return `${starColors[10]}${starLevel}✫`;

        return `${starColors[Math.floor(starLevel / 100)]}${starLevel}✫`;
    }

    getColoredFKDR(fkdr) {
        const fkdrNum = parseFloat(fkdr)

        if (fkdrNum >= process.env.GREAT_FKDR) return `§4${fkdr}` // dark red
        if (fkdrNum >= process.env.GOOD_FKDR) return `§c${fkdr}` // red
        if (fkdrNum >= process.env.MEDIUM_FKDR) return `§6${fkdr}` // orange
        if (fkdrNum >= process.env.LOW_FKDR) return `§e${fkdr}` // yellow
        return `§7${fkdr}` // gray
    }

    async getMojangUUID(username) {
        try {
            const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`)
            if (!response.ok) return null
            const data = await response.json()
            return data.id
        } catch (err) {
            console.error("fetch error:", err)
            return null
        }
    }

    async getBedwarsStats(uuid) {
        try {
            const response = await fetch(`https://api.hypixel.net/v2/player?key=${process.env.API_KEY}&uuid=${uuid}`)
            if (!response.ok) return null
            const data = await response.json()
            if (!data.success || !data.player) return null

            const bw = data.player.stats?.Bedwars
            if (!bw) return null

            const stars = Math.floor(bw.Experience / 5000)
            const finalKills = bw.final_kills_bedwars || 0
            const finalDeaths = bw.final_deaths_bedwars || 1
            const fkdr = (finalKills / finalDeaths).toFixed(2)

            return { stars, fkdr }
        } catch (err) {
            console.error("hypixel api error:", err)
            return null
        }
    }

    handleLogin(client) {
        console.log(`Client connected: ${client.username}`)

        const target = mc.createClient({
            host: "mc.hypixel.net",
            port: 25565,
            username: client.username,
            uuid: client.id,
            auth: "microsoft",
            version: false,
            profile: client.profile,
            profilesFolder: "./cache"
        })

        client.on("packet", (data, meta) => {
            if (target.state === meta.state) {
                try {
                    target.write(meta.name, data)
                } catch (err) {
                    console.error(`Error forwarding client to server packet ${meta.name}:`, err)
                }
            }
        })

        target.on("packet", (data, meta) => {
            if (client.state === meta.state) {
                try {
                    client.write(meta.name, data)
                } catch (err) {
                    console.error(`Error forwarding server to client packet ${meta.name}:`, err)
                }
            }
        })

        client.on("error", (err) => {
            console.error("Client error:", err)
            target.end()
        })

        target.on("error", (err) => {
            console.error("Target error:", err)
            client.end()
        })

        client.on("end", () => {
            console.log(`Client disconnected: ${client.username}`)
            target.end()
        })

        target.on("end", () => {
            console.log(`Disconnected from target server: ${client.username}`)
            client.end()
        })

        target.on("chat", (packet) => {
            this.handleChatPacket(client, packet)
        })
    }

    handleChatPacket(client, packet) {
        try {
            const rawMessage = this.extractText(JSON.parse(packet.message))

            if (rawMessage.startsWith("ONLINE: ")) {
                console.log("Beginning statchecks.")
                const players = rawMessage.replace("ONLINE: ", "").split(", ")

                players.forEach((name, i) => {
                    setTimeout(() => {
                        console.log(`Statchecking ${name}.`)
                        if (this.statCache.has(name)) {
                            console.log(`${name} found in cache.`)
                            return this.proxyChat(client, this.statCache.get(name))
                        }

                        this.getMojangUUID(name).then(uuid => {
                            if (!uuid) {
                                console.log("No uuid found.")
                                return this.proxyChat(client, `${name}: §cNo uuid found`)
                            }

                            this.getBedwarsStats(uuid).then(stats => {
                                if (!stats) {
                                    console.log("No stats found.")
                                    return this.proxyChat(client, `${name}: §cNo stats found`)
                                }

                                console.log("Stats found. Adding to cache.")
                                const msg = this.formatStatsMessage(name, stats)
                                this.statCache.set(name, msg)
                                this.proxyChat(client, this.formatStatsMessage(name, stats))
                            })
                        })
                    }, process.env.CHECK_DELAY * i)
                })
            }
        } catch (e) {
            console.error("Error processing chat packet:", e)
        }
    }
}

new HyProxy()