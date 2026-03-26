using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Data;

public static class SeedData
{
    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.PromptCards.AnyAsync()) return;

        var cards = new[]
        {
            "Explain why we need to pivot our core competency to leverage synergistic paradigm shifts.",
            "Describe how our agile transformation will unlock unprecedented stakeholder value.",
            "Present the ROI case for investing in a blockchain-powered HR onboarding portal.",
            "Convince the board that our net-zero roadmap will actually increase Q4 margins.",
            "Walk us through your 90-day plan to disrupt the legacy enterprise middleware market.",
            "Justify doubling the headcount of the innovation lab with zero measurable KPIs.",
            "Explain why remote-first culture is the secret weapon for retaining Gen Z talent.",
            "Present your vision for an AI-driven customer journey orchestration platform.",
            "Describe the competitive moat we'll build through radical supply chain transparency.",
            "Make the case for replacing all internal meetings with async video updates.",
            "Explain how gamification will drive a 40% uptick in employee engagement scores.",
            "Outline the go-to-market strategy for our SaaS-ified expense management tool.",
            "Convince leadership to fund a metaverse presence for the annual sales kickoff.",
            "Present the data showing our NPS improvement plan will outpace our top competitor.",
            "Describe how we'll achieve operational excellence through zero-touch automation.",
            "Explain the strategic rationale behind acquiring a failing podcast network.",
            "Walk through why we need a Chief Vibes Officer on the executive team.",
            "Present the framework for our diversity, equity, and inclusion-washing rebrand.",
            "Justify the expense of a company-wide mandatory improv comedy workshop.",
            "Convince the CFO that investing in standing desks will reduce churn by 15%.",
            "Explain why our product needs a NFT loyalty program to stay relevant.",
            "Outline your plan to turn every customer complaint into a viral marketing moment.",
            "Describe the three-phase digital transformation that will future-proof our business.",
            "Make the case for spinning off the coffee machine maintenance team into a startup.",
            "Present why our new OKR framework is different from all the previous OKR frameworks.",
            "Explain how integrating mindfulness into sprint planning will accelerate delivery.",
            "Walk us through the business case for a four-day work week with five days of output.",
            "Describe how we'll use machine learning to predict which emails deserve a reply.",
            "Justify the rebranding of 'bugs' as 'unplanned features' in customer communications.",
            "Present your strategy for monetising our internal Slack meme channel.",
            "Explain why we need a dedicated team to manage our thought leadership pipeline.",
            "Outline how a corporate hackathon will solve our three-year product backlog.",
            "Convince the team that technical debt is actually a hidden competitive advantage.",
            "Describe your framework for maintaining work-life integration in a 24/7 on-call culture.",
            "Walk through the synergy opportunities between the snack budget and R&D expenditure.",
            "Present the roadmap for turning our monolith into 47 independently deployable microservices.",
            "Explain why the company needs an official policy on acceptable GIF usage in Slack.",
            "Justify renaming the engineering team to 'experience architects' in all job postings.",
            "Make the case that our biggest risk is not moving fast enough AND not moving too fast.",
            "Describe how we'll leverage big data to personalise the office thermostat settings.",
            "Explain the value of a mandatory monthly 'failure festival' for the leadership team.",
            "Present your hybrid cloud multi-region disaster recovery architecture to a room of sales reps.",
            "Outline why we need to rebuild our entire data pipeline in the language you learned last weekend.",
            "Convince your manager that attending three more conferences this year is mission critical.",
            "Explain how renaming sprints to 'delivery waves' will solve team morale issues.",
            "Walk through why a 200-slide deck is the most efficient way to communicate this strategy.",
            "Describe the ROI of replacing the office plants with data-centre cooling infrastructure.",
            "Present your plan to eliminate all company emails and replace them with handwritten notes.",
            "Justify using an LLM to generate all future mission and values statements.",
            "Explain why the solution to every problem in this organisation is better documentation.",
            "Outline the strategic importance of rewriting the entire frontend in whichever framework launched this month.",
            "Make the case for a company-mandated afternoon nap policy backed by neuroscience.",
            "Describe how a single pane of glass dashboard will finally align sales and engineering.",
            "Present the business value of building a proprietary internal search engine to replace Google.",
            "Explain why the fastest path to product-market fit is a full rebrand and new logo.",
        };

        db.PromptCards.AddRange(cards.Select(text => new PromptCard { Text = text }));
        await db.SaveChangesAsync();
    }
}
