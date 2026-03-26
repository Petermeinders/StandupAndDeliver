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
            "Wrote an email to the boss about a clogged toilet",
            "Cleared a jam from the printer",
            "Refilled the coffee pot",
            "Refilled the water cooler",
            "Micro-managed my employees",
            "Replied to an email that said 'thanks' with 'no problem'",
            "Updated my out-of-office message",
            "Attended a meeting that could have been an email",
            "Forwarded emails without reading them",
            "Moved a task from 'In Progress' to 'Done'",
            "Ordered more sticky notes",
            "Reorganised my desktop icons",
            "Changed the font in a presentation for 45 minutes",
            "Asked IT to fix the thing I unplugged myself",
            "Had a meeting to discuss the upcoming meeting",
            "Printed a document just to scan it back in as a PDF",
            "Replaced the empty paper tray and told everyone about it",
            "Wiped down my keyboard and desk",
            "Made a to-do list",
            "Wrote a passive-aggressive note in the kitchen about dish cleanliness",
            "Submitted an expense report for a $4.50 coffee",
            "Moved the stapler back to where it belongs",
            "Organised a folder on the shared drive nobody uses",
            "Watered the office plant that is definitely already dead",
            "Turned it off and on again",
            "Replied 'per my last email' and meant every word",
            "Fixed a typo on the company website",
            "Adjusted the office thermostat while no one was looking",
            "Suggested a new process to fix a process no one follows anyway",
            "Filled out a form to request access to a form",
            "Set up a recurring meeting to check in on the recurring meeting",
            "Left 10 voicemails to one person",
            "Googled office jokes and shared them with the team all day",
            "Fliered with my coworker",
            "Made a spreadsheet to track something already in the system",
            "Clicked 'Reply All' by mistake and apologised to 47 people individually",

            "Updated a spreadsheet cell from green to slightly lighter green",
            "Color-coded a calendar that absolutely no one else looks at",
            "Submitted a help desk ticket for a problem I solved myself",
            "Archived an email folder from 2018 just in case",
            "Sent the same file in three different formats just to be safe",
            "Broke the printer and blamed it on the paper quality",
            "Added a 'Confidential' watermark to a document detailing the holiday party menu",
            "Updated my email signature to include a new title",
            "Read the company newsletter, replied with an emoji",
            "Gave a coworker unsolicited feedback on their email tone",
            "Hand delivered the agenda for a meeting to 20 people",
            "Spent the day looking through menu catering ideas for the holiday party",

            "Debated the Oxford comma in the style guide for one hour",
        };

        db.PromptCards.AddRange(cards.Select(text => new PromptCard { Text = text }));
        await db.SaveChangesAsync();
    }
}
