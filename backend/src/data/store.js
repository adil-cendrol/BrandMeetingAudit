// In-memory store (replace with DB in production)
const assessments = new Map();

const getAll = () => Array.from(assessments.values()).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
const getById = (id) => assessments.get(id);
const save = (assessment) => assessments.set(assessment.id, assessment);
const remove = (id) => assessments.delete(id);

module.exports = { getAll, getById, save, remove };
