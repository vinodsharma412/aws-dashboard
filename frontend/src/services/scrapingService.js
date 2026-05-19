import api from './api';

export const scrapingService = {
  createJob: (asins) => api.post('/scraping/jobs', { asins }),
  listJobs:  ()       => api.get('/scraping/jobs'),
  getJob:    (jobId)  => api.get(`/scraping/jobs/${jobId}`),
};
