import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { Course } from './CoursesScreen';

export interface SrsFormData {
  courseCode: string;
  courseTitle: string;
  isLab: boolean;
  surveyType: 'mid_sem' | 'end_sem';
  general: {
    q1?: 'yes' | 'no';
    q2?: 'yes' | 'no';
    q3?: 'yes' | 'no';
    q4?: 'yes' | 'no';
    aspects?: string;
    suggestion?: string;
  };
  evaluation: {
    q1?: 'yes' | 'no';
    q2?: 'yes' | 'no';
    q3?: 'yes' | 'no';
    q4?: 'yes' | 'no';
    q5?: 'yes' | 'no';
  };
  selfEvaluation: {
    q1?: 'yes' | 'no';
    q2?: 'yes' | 'no';
    q3?: 'yes' | 'no';
    q4?: 'yes' | 'no';
    q5?: 'yes' | 'no';
  };
}

interface CourseSrsModalProps {
  visible: boolean;
  course: Course | null;
  onClose: () => void;
  onSubmit: (data: SrsFormData) => Promise<boolean>;
}

export default function CourseSrsModal({
  visible,
  course,
  onClose,
  onSubmit,
}: CourseSrsModalProps) {
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [instructionsAccepted, setInstructionsAccepted] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Form State
  const [generalQ, setGeneralQ] = useState<{ [key: string]: 'yes' | 'no' }>({});
  const [aspectsText, setAspectsText] = useState<string>('');
  const [suggestionText, setSuggestionText] = useState<string>('');
  const [evalQ, setEvalQ] = useState<{ [key: string]: 'yes' | 'no' }>({});
  const [selfEvalQ, setSelfEvalQ] = useState<{ [key: string]: 'yes' | 'no' }>({});

  const isLabCourse = course
    ? /lab|laboratory|practical/i.test(course.courseTitle) || course.courseCode.includes('Lab')
    : false;

  const isMidSem = course?.srsStatus?.midSemAvailable ?? true;
  const surveyTitle = isMidSem ? 'Mid-Sem SRS' : 'End-Sem SRS';

  useEffect(() => {
    if (visible) {
      setCurrentStep(1);
      setInstructionsAccepted(false);
      setGeneralQ({});
      setAspectsText('');
      setSuggestionText('');
      setEvalQ({});
      setSelfEvalQ({});
      setSubmitting(false);
    }
  }, [visible, course?.courseCode]);

  if (!course) return null;

  // Validation checkers per step
  const isStep2Valid = () => {
    if (isLabCourse) return true; // Lab general inputs are optional textareas
    return !!(generalQ['1'] && generalQ['2'] && generalQ['3'] && generalQ['4']);
  };

  const isStep3Valid = () => {
    if (isLabCourse) {
      return !!(evalQ['1'] && evalQ['2'] && evalQ['3'] && evalQ['4']);
    }
    return !!(evalQ['1'] && evalQ['2'] && evalQ['3'] && evalQ['4'] && evalQ['5']);
  };

  const isStep4Valid = () => {
    if (isLabCourse) {
      return !!(selfEvalQ['1'] && selfEvalQ['2'] && selfEvalQ['3']);
    }
    return !!(selfEvalQ['1'] && selfEvalQ['2'] && selfEvalQ['3'] && selfEvalQ['4'] && selfEvalQ['5']);
  };

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFinalSubmit = async () => {
    if (!isStep4Valid()) return;

    setSubmitting(true);
    const payload: SrsFormData = {
      courseCode: course.courseCode,
      courseTitle: course.courseTitle,
      isLab: isLabCourse,
      surveyType: isMidSem ? 'mid_sem' : 'end_sem',
      general: {
        q1: generalQ['1'],
        q2: generalQ['2'],
        q3: generalQ['3'],
        q4: generalQ['4'],
        aspects: aspectsText.trim(),
        suggestion: suggestionText.trim(),
      },
      evaluation: {
        q1: evalQ['1'],
        q2: evalQ['2'],
        q3: evalQ['3'],
        q4: evalQ['4'],
        q5: evalQ['5'],
      },
      selfEvaluation: {
        q1: selfEvalQ['1'],
        q2: selfEvalQ['2'],
        q3: selfEvalQ['3'],
        q4: selfEvalQ['4'],
        q5: selfEvalQ['5'],
      },
    };

    const success = await onSubmit(payload);
    setSubmitting(false);
    if (success) {
      onClose();
    }
  };

  const renderYesNoRadio = (
    selected: 'yes' | 'no' | undefined,
    onSelect: (val: 'yes' | 'no') => void
  ) => (
    <View style={styles.radioGroup}>
      <TouchableOpacity
        style={[styles.radioOption, selected === 'yes' && styles.radioOptionSelectedYes]}
        onPress={() => onSelect('yes')}
        activeOpacity={0.7}
      >
        <Ionicons
          name={selected === 'yes' ? 'checkmark-circle' : 'ellipse-outline'}
          size={16}
          color={selected === 'yes' ? Theme.colors.successGreen : Theme.colors.textSecondary}
        />
        <Text style={[styles.radioLabel, selected === 'yes' && styles.radioLabelSelectedYes]}>
          Yes
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.radioOption, selected === 'no' && styles.radioOptionSelectedNo]}
        onPress={() => onSelect('no')}
        activeOpacity={0.7}
      >
        <Ionicons
          name={selected === 'no' ? 'close-circle' : 'ellipse-outline'}
          size={16}
          color={selected === 'no' ? Theme.colors.dangerRed : Theme.colors.textSecondary}
        />
        <Text style={[styles.radioLabel, selected === 'no' && styles.radioLabelSelectedNo]}>
          No
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16 }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <View style={styles.titleBadgeRow}>
                <Text style={styles.courseCodeBadge}>{course.courseCode}</Text>
                <View
                  style={[
                    styles.surveyTypeBadge,
                    {
                      backgroundColor: isMidSem
                        ? Theme.colors.accentOrange
                        : Theme.colors.lavender,
                    },
                  ]}
                >
                  <Text style={styles.surveyTypeBadgeText}>{surveyTitle}</Text>
                </View>
                {isLabCourse && (
                  <View style={styles.labBadge}>
                    <Text style={styles.labBadgeText}>Lab Course</Text>
                  </View>
                )}
              </View>
              <Text style={styles.courseTitleText} numberOfLines={1}>
                {course.courseTitle}
              </Text>
              <Text style={styles.instructorText} numberOfLines={1}>
                Prof. {course.instructor || 'Not Assigned'}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={Theme.colors.textDark} />
            </TouchableOpacity>
          </View>

          {/* Step Progress Indicator */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBackground}>
              <View style={[styles.progressBarFill, { width: `${(currentStep / 4) * 100}%` }]} />
            </View>
            <View style={styles.stepsRow}>
              {[
                { step: 1, label: 'Instructions' },
                { step: 2, label: 'General' },
                { step: 3, label: isLabCourse ? 'Rate Lab' : 'Rate Course' },
                { step: 4, label: 'Self Evaluation' },
              ].map((s) => (
                <View key={s.step} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepCircle,
                      currentStep === s.step && styles.stepCircleActive,
                      currentStep > s.step && styles.stepCircleCompleted,
                    ]}
                  >
                    {currentStep > s.step ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : (
                      <Text
                        style={[
                          styles.stepNumber,
                          currentStep === s.step && styles.stepNumberActive,
                        ]}
                      >
                        {s.step}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      currentStep === s.step && styles.stepLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Form Content */}
          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={styles.scrollInner}
            showsVerticalScrollIndicator={false}
          >
            {/* STEP 1: Instructions */}
            {currentStep === 1 && (
              <View style={styles.stepContainer}>
                <View style={styles.infoBanner}>
                  <Ionicons name="shield-checkmark" size={22} color={Theme.colors.accentOrange} />
                  <View style={styles.infoBannerTextWrap}>
                    <Text style={styles.infoBannerTitle}>Strictly Confidential & Anonymous</Text>
                    <Text style={styles.infoBannerSub}>
                      Your responses are summarized into anonymous cohort reports. No personally identifiable details are shared with instructors or TAs.
                    </Text>
                  </View>
                </View>

                <View style={styles.instructionsCard}>
                  <Text style={styles.instructionsHeading}>Guidelines for Meaningful Feedback</Text>
                  <Text style={styles.instructionsParagraph}>
                    • Judge your teacher and your own engagement honestly, constructively, and politely.
                  </Text>
                  <Text style={styles.instructionsParagraph}>
                    • Mention specific aspects you appreciated (e.g., clarity of concepts, well-designed assignments, multimedia aids) and actionable suggestions for improvement.
                  </Text>
                  <Text style={styles.instructionsParagraph}>
                    • Avoid criticizing factors beyond instructor control (classroom temperature, lecture timing, chalk quality).
                  </Text>
                  <Text style={styles.instructionsParagraph}>
                    • Don't hesitate to thank your instructor if you enjoyed learning from them!
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => setInstructionsAccepted(!instructionsAccepted)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={instructionsAccepted ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={instructionsAccepted ? Theme.colors.accentOrange : Theme.colors.textSecondary}
                  />
                  <Text style={styles.checkboxLabel}>
                    I have carefully read and understood the instructions above.
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* STEP 2: General Inputs */}
            {currentStep === 2 && (
              <View style={styles.stepContainer}>
                {!isLabCourse ? (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 *</Text>
                      <Text style={styles.questionText}>
                        Are you either a major or minor in the department in which this course was offered?
                      </Text>
                      {renderYesNoRadio(generalQ['1'], (val) =>
                        setGeneralQ((prev) => ({ ...prev, '1': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 *</Text>
                      <Text style={styles.questionText}>Is this a mandatory course?</Text>
                      {renderYesNoRadio(generalQ['2'], (val) =>
                        setGeneralQ((prev) => ({ ...prev, '2': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 3 *</Text>
                      <Text style={styles.questionText}>
                        I would recommend this course to other students.
                      </Text>
                      {renderYesNoRadio(generalQ['3'], (val) =>
                        setGeneralQ((prev) => ({ ...prev, '3': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 4 *</Text>
                      <Text style={styles.questionText}>
                        The learning expectations and grading policies were made clear at the start of the course.
                      </Text>
                      {renderYesNoRadio(generalQ['4'], (val) =>
                        setGeneralQ((prev) => ({ ...prev, '4': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 5 (Optional)</Text>
                      <Text style={styles.questionText}>
                        Please identify specific aspects of the course that helped you learn better:
                      </Text>
                      <TextInput
                        style={styles.textArea}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        placeholder="e.g. Excellent problem solving sessions, clear slide explanations..."
                        placeholderTextColor={Theme.colors.textSecondary}
                        value={aspectsText}
                        onChangeText={setAspectsText}
                      />
                      <Text style={styles.charCount}>{aspectsText.length}/1000</Text>
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 6 (Optional)</Text>
                      <Text style={styles.questionText}>
                        What improvements do you suggest to help learn the course better?
                      </Text>
                      <TextInput
                        style={styles.textArea}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        placeholder="e.g. Additional practical examples, recorded session summaries..."
                        placeholderTextColor={Theme.colors.textSecondary}
                        value={suggestionText}
                        onChangeText={setSuggestionText}
                      />
                      <Text style={styles.charCount}>{suggestionText.length}/1000</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 (Optional)</Text>
                      <Text style={styles.questionText}>
                        Please identify specific aspects of the laboratory course that helped you learn better:
                      </Text>
                      <TextInput
                        style={styles.textArea}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        placeholder="e.g. Hands-on guidance during experiments..."
                        placeholderTextColor={Theme.colors.textSecondary}
                        value={aspectsText}
                        onChangeText={setAspectsText}
                      />
                      <Text style={styles.charCount}>{aspectsText.length}/1000</Text>
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 (Optional)</Text>
                      <Text style={styles.questionText}>
                        What improvements do you suggest to help learn the laboratory course better?
                      </Text>
                      <TextInput
                        style={styles.textArea}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        placeholder="e.g. Extra lab practice hours, more troubleshooting tips..."
                        placeholderTextColor={Theme.colors.textSecondary}
                        value={suggestionText}
                        onChangeText={setSuggestionText}
                      />
                      <Text style={styles.charCount}>{suggestionText.length}/1000</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {/* STEP 3: Rate Course / Rate Lab */}
            {currentStep === 3 && (
              <View style={styles.stepContainer}>
                {!isLabCourse ? (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 *</Text>
                      <Text style={styles.questionText}>
                        The course was taught in an organized fashion and interactive sessions/pre-recorded material were appropriate.
                      </Text>
                      {renderYesNoRadio(evalQ['1'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '1': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 *</Text>
                      <Text style={styles.questionText}>
                        The course promoted conceptual understanding and critical thinking.
                      </Text>
                      {renderYesNoRadio(evalQ['2'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '2': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 3 *</Text>
                      <Text style={styles.questionText}>
                        Questions were encouraged and answered satisfactorily.
                      </Text>
                      {renderYesNoRadio(evalQ['3'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '3': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 4 *</Text>
                      <Text style={styles.questionText}>
                        Board and other teaching aids/technology resources were used effectively to aid learning.
                      </Text>
                      {renderYesNoRadio(evalQ['4'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '4': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 5 *</Text>
                      <Text style={styles.questionText}>
                        Course was effective and significantly enhanced learning.
                      </Text>
                      {renderYesNoRadio(evalQ['5'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '5': val }))
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 *</Text>
                      <Text style={styles.questionText}>
                        Demonstrations and instructions were helpful.
                      </Text>
                      {renderYesNoRadio(evalQ['1'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '1': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 *</Text>
                      <Text style={styles.questionText}>
                        Equipments / Instruments available in the laboratory were functioning properly.
                      </Text>
                      {renderYesNoRadio(evalQ['2'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '2': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 3 *</Text>
                      <Text style={styles.questionText}>
                        Laboratory reports were corrected and returned in time.
                      </Text>
                      {renderYesNoRadio(evalQ['3'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '3': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 4 *</Text>
                      <Text style={styles.questionText}>
                        Experiments were conducted smoothly.
                      </Text>
                      {renderYesNoRadio(evalQ['4'], (val) =>
                        setEvalQ((prev) => ({ ...prev, '4': val }))
                      )}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* STEP 4: Rate Yourself */}
            {currentStep === 4 && (
              <View style={styles.stepContainer}>
                {!isLabCourse ? (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 *</Text>
                      <Text style={styles.questionText}>
                        I was prepared to take the course before the term started.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['1'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '1': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 *</Text>
                      <Text style={styles.questionText}>
                        I clarified doubts in class and asked questions frequently.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['2'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '2': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 3 *</Text>
                      <Text style={styles.questionText}>
                        I spent at least 2 hours in self-study for every 1 hour of lecture.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['3'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '3': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 4 *</Text>
                      <Text style={styles.questionText}>
                        I worked independently on completing my assignments and submitted them on time.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['4'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '4': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 5 *</Text>
                      <Text style={styles.questionText}>
                        I approached the Instructor outside the class when I required help.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['5'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '5': val }))
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 1 *</Text>
                      <Text style={styles.questionText}>
                        I was prepared to conduct the experiment before every laboratory class.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['1'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '1': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 2 *</Text>
                      <Text style={styles.questionText}>
                        I completed the experiments and submitted the report on time.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['2'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '2': val }))
                      )}
                    </View>

                    <View style={styles.questionCard}>
                      <Text style={styles.questionNumber}>Question 3 *</Text>
                      <Text style={styles.questionText}>
                        I approached the Instructor outside the lab when I required help.
                      </Text>
                      {renderYesNoRadio(selfEvalQ['3'], (val) =>
                        setSelfEvalQ((prev) => ({ ...prev, '3': val }))
                      )}
                    </View>
                  </>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer Controls */}
          <View style={styles.footer}>
            {currentStep > 1 && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleBack}
                disabled={submitting}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={18} color={Theme.colors.textDark} />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}

            {currentStep === 1 && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  !instructionsAccepted && styles.primaryButtonDisabled,
                ]}
                onPress={handleNext}
                disabled={!instructionsAccepted}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Begin Survey</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            )}

            {currentStep === 2 && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  !isStep2Valid() && styles.primaryButtonDisabled,
                ]}
                onPress={handleNext}
                disabled={!isStep2Valid()}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Next: Course Rating</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            )}

            {currentStep === 3 && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  !isStep3Valid() && styles.primaryButtonDisabled,
                ]}
                onPress={handleNext}
                disabled={!isStep3Valid()}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Next: Self Rating</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            )}

            {currentStep === 4 && (
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (!isStep4Valid() || submitting) && styles.primaryButtonDisabled,
                ]}
                onPress={handleFinalSubmit}
                disabled={!isStep4Valid() || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Submit Survey</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '75%',
    display: 'flex',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  courseCodeBadge: {
    fontSize: 13,
    fontWeight: '800',
    color: Theme.colors.textDark,
  },
  surveyTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  surveyTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  labBadge: {
    backgroundColor: Theme.colors.mint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  labBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.textDark,
  },
  courseTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.textDark,
    marginBottom: 2,
  },
  instructorText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.accentOrange,
    borderRadius: 2,
  },
  stepsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepCircleActive: {
    backgroundColor: Theme.colors.accentOrange,
  },
  stepCircleCompleted: {
    backgroundColor: Theme.colors.successGreen,
  },
  stepNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.textSecondary,
  },
  stepNumberActive: {
    color: '#fff',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: Theme.colors.textSecondary,
  },
  stepLabelActive: {
    fontWeight: '700',
    color: Theme.colors.accentOrange,
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 20,
    paddingBottom: 24,
  },
  stepContainer: {
    gap: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF4E5',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  infoBannerTextWrap: {
    flex: 1,
  },
  infoBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D84315',
    marginBottom: 4,
  },
  infoBannerSub: {
    fontSize: 12,
    lineHeight: 17,
    color: '#5D4037',
  },
  instructionsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  instructionsHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.textDark,
    marginBottom: 10,
  },
  instructionsParagraph: {
    fontSize: 13,
    lineHeight: 19,
    color: Theme.colors.textDark,
    marginBottom: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    gap: 12,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textDark,
  },
  questionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  questionNumber: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: Theme.colors.accentOrange,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  questionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: Theme.colors.textDark,
    marginBottom: 12,
  },
  radioGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  radioOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#FAFAFA',
  },
  radioOptionSelectedYes: {
    borderColor: Theme.colors.successGreen,
    backgroundColor: '#E8F5E9',
  },
  radioOptionSelectedNo: {
    borderColor: Theme.colors.dangerRed,
    backgroundColor: '#FFEBEE',
  },
  radioLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  radioLabelSelectedYes: {
    color: Theme.colors.successGreen,
    fontWeight: '700',
  },
  radioLabelSelectedNo: {
    color: Theme.colors.dangerRed,
    fontWeight: '700',
  },
  textArea: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: Theme.colors.textDark,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.textDark,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Theme.colors.accentOrange,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Theme.colors.accentOrange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Theme.colors.successGreen,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Theme.colors.successGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryButtonDisabled: {
    backgroundColor: '#E0E0E0',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
