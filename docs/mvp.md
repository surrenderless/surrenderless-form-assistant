# Surrenderless MVP
Purpose: Help consumers escalate issues against retailers and online platforms (e.g., Amazon) by auto-filling government complaint forms.

Initial Scope: FTC Consumer Complaint form (proof of concept).

Flow:
1. User types a goal (e.g., “file complaint against Amazon”).
2. AI interprets and generates a step plan.
3. Browser automation opens the FTC complaint form site.
4. Form fields are auto-filled from stored or requested user data.
5. User reviews a preview and submits.

Components:
- UI: Simple text box for goal input
- Backend: Clerk authentication, Supabase memory, AI planner
- Automation: Playwright (form navigation + fill)
- Memory: Supabase (user_profiles, task_logs)

Acceptance Tests:
- AT1: User inputs “complaint against Amazon”
- AT2: AI returns a structured plan with steps
- AT3: Automation launches FTC complaint form
- AT4: Form fields fill with profile data
- AT5: User gets preview + confirmation of successful submission
