# 0.2 — structured JSX rebuild

Replaced the monolithic mobile file with separated auth, API, navigation, components, theme and role workflows. Replaced the monolithic API with models, validation, middleware, routes and services. Removed TypeScript application files and all placeholder dashboard module tiles. Added real account assignment/revocation, branches/classes/admissions, roster attendance, timetable, notices, assignments, optional AI transcript generation/text review, quizzes, invoice/payment records and audit history. No demo seed.

This replaces the first 0.1 prototype. Use a new database because records now use MongoDB ObjectId references rather than arbitrary strings.
