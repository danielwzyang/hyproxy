module.exports = {
    log,
    extractText,
    formatStatsMessage,
}

function log(message) {
    console.log(`${new Date().toLocaleTimeString()}: ${message}`)
}

function formatStatsMessage(username, stats, benchmarks) {
    return `${getRankColor(stats.rank)}${username}: ${getColoredStar(stats.stars)} §7| ${getColoredFKDR(stats.fkdr, benchmarks)} FKDR §7| §2${stats.guild}`
}

function getRankColor(rank) {
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

function getColoredStar(starLevel) {
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

function getColoredFKDR(fkdr, benchmarks) {
    const fkdrNum = parseFloat(fkdr)

    if (fkdrNum >= benchmarks.good) return `§c${fkdr}` // red
    if (fkdrNum >= benchmarks.medium) return `§6${fkdr}` // orange
    if (fkdrNum >= benchmarks.low) return `§e${fkdr}` // yellow
    return `§7${fkdr}` // gray
}

function extractText(component) {
    let res = ""

    if (component.text) res += component.text

    if (component.extra)
        component.extra.forEach(part => res += extractText(part))

    return res
}