namespace StandupAndDeliver.Data;

public static class CorporateBsData
{
    public static readonly string[] Verbs =
    [
        "aggregated", "architected", "benchmarked", "branded", "cultivated",
        "delivered", "deployed", "disintermediated", "drove", "e-enabled",
        "embraced", "empowered", "enabled", "engaged", "engineered",
        "enhanced", "envisineered", "evolved", "expedited", "exploited",
        "extended", "facilitated", "generated", "grew", "harnessed",
        "implemented", "incentivized", "incubated", "innovated", "integrated",
        "iterated", "leveraged", "matrixed", "maximized", "meshed",
        "monetized", "morphed", "optimized", "orchestrated", "productized",
        "recontextualized", "redefined", "reintermediated", "reinvented", "repurposed",
        "revolutionized", "scaled", "seized", "strategized", "streamlined",
        "syndicated", "synergized", "synthesized", "targeted", "transformed",
        "transitioned", "unleashed", "utilized", "visualized", "whiteboardeded"
    ];

    public static readonly string[] Adjectives =
    [
        "24/365", "24/7", "B2B", "B2C", "back-end",
        "best-of-breed", "bleeding-edge", "bricks-and-clicks", "clicks-and-mortar", "collaborative",
        "compelling", "cross-platform", "cross-media", "customized", "cutting-edge",
        "distributed", "dot-com", "dynamic", "e-business", "efficient",
        "end-to-end", "enterprise", "extensible", "frictionless", "front-end",
        "global", "granular", "holistic", "impactful", "innovative",
        "integrated", "interactive", "intuitive", "killer", "leading-edge",
        "magnetic", "mission-critical", "next-generation", "one-to-one", "open-source",
        "out-of-the-box", "plug-and-play", "proactive", "real-time", "revolutionary",
        "rich", "robust", "scalable", "seamless", "sexy",
        "sticky", "strategic", "synergistic", "transparent", "turn-key",
        "ubiquitous", "user-centric", "value-added", "vertical", "viral",
        "virtual", "visionary", "web-enabled", "wireless", "world-class"
    ];

    public static readonly string[] Nouns =
    [
        "action-items", "applications", "architectures", "bandwidth", "channels",
        "communities", "content", "convergence", "deliverables", "e-business",
        "e-commerce", "e-markets", "e-services", "e-tailers", "experiences",
        "eyeballs", "functionalities", "infomediaries", "infrastructures", "initiatives",
        "interfaces", "markets", "methodologies", "metrics", "mindshare",
        "models", "networks", "niches", "paradigms", "partnerships",
        "platforms", "portals", "relationships", "ROI", "synergies",
        "web-readiness", "schemas", "solutions", "supply-chains", "systems",
        "technologies", "users", "vortals", "web services"
    ];

    public static (string Verb, string Adjective, string Noun) PickRandom()
    {
        return (
            Verbs[Random.Shared.Next(Verbs.Length)],
            Adjectives[Random.Shared.Next(Adjectives.Length)],
            Nouns[Random.Shared.Next(Nouns.Length)]
        );
    }
}
