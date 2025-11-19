package service

// Predefined security questions - user must pick 3
var SecurityQuestionsList = []string{
	"What was the name of your first pet?",
	"What is your mother's maiden name?",
	"What was the name of your first school?",
	"What is your favorite movie?",
	"What city were you born in?",
	"What is your father's middle name?",
	"What was your childhood nickname?",
	"What is the name of the street you grew up on?",
	"What was the make of your first car?",
	"What is your favorite book?",
}

// ValidateSecurityQuestions ensures user picked exactly 3 unique questions from the list
func ValidateSecurityQuestions(questions []string) bool {
	if len(questions) != 3 {
		return false
	}

	// Check all questions are from the predefined list
	questionSet := make(map[string]bool)
	for _, q := range questions {
		valid := false
		for _, validQ := range SecurityQuestionsList {
			if q == validQ {
				valid = true
				break
			}
		}
		if !valid {
			return false
		}

		// Check for duplicates
		if questionSet[q] {
			return false
		}
		questionSet[q] = true
	}

	return true
}
